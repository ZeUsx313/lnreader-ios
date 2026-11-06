/**
 * iOS implementation of the NativeBackgroundTasks module contract.
 *
 * React Native offers no headless-JS execution on iOS (Android's
 * HeadlessJsTaskService has no equivalent), so this module provides the same
 * persistent task queue in pure TypeScript:
 *  - Records are persisted in a dedicated MMKV instance; the queue survives
 *    app restarts exactly like the Android Room database does.
 *  - Execution is driven by the in-app scheduler
 *    (src/services/backgroundTasks/iosScheduler.ts) while the app is
 *    foregrounded; tasks interrupted by an app kill are reset to 'queued'
 *    on the next launch and resume from their checkpoint.
 *  - Periodic schedules (library updates / automatic backups) are persisted
 *    here and checked against their last-fire time on app start.
 *
 * Trade-off vs Android: nothing runs while the app is killed. A native
 * BGTaskScheduler port cannot execute the JS task bodies either, so this
 * foreground-executor design is the functional equivalent available to a
 * React Native app (documented in docs/ios-port/LIMITATIONS.md).
 */
import { createMMKV } from 'react-native-mmkv';

export type IosBackgroundTaskRecord = {
  id: string;
  type: string;
  title: string;
  description?: string;
  state: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  progress?: number;
  progressText?: string;
  completionText?: string;
  attempt: number;
  createdAt: number;
  updatedAt: number;
  payload: string;
  checkpoint?: string;
  queueName: string;
};

type ScheduleConfig = {
  intervalHours: number;
  title: string;
  description: string;
  directoryUri?: string;
  enabled: boolean;
};

const STORAGE_ID = 'lnreader_background_tasks';
const RECORDS_KEY = 'records';
const LIBRARY_UPDATES_KEY = 'schedule:library-updates';
const AUTOMATIC_BACKUPS_KEY = 'schedule:automatic-backups';
const LAST_LIBRARY_UPDATE_KEY = 'schedule:last-library-update';
const LAST_AUTOMATIC_BACKUP_KEY = 'schedule:last-automatic-backup';
const TERMINAL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;

const storage = createMMKV({ id: STORAGE_ID });

let idCounter = 0;
const makeId = () => {
  idCounter += 1;
  return `ios-${Date.now().toString(36)}-${idCounter}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
};

const readRecords = (): IosBackgroundTaskRecord[] => {
  const raw = storage.getString(RECORDS_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as IosBackgroundTaskRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeRecords = (records: IosBackgroundTaskRecord[]) => {
  const cutoff = Date.now() - TERMINAL_RETENTION_MS;
  storage.set(
    RECORDS_KEY,
    JSON.stringify(
      records.filter(
        record =>
          !isTerminal(record.state) || record.updatedAt >= cutoff,
      ),
    ),
  );
};

const isTerminal = (state: IosBackgroundTaskRecord['state']) =>
  state === 'completed' || state === 'failed' || state === 'cancelled';

const findRecord = (taskId: string) =>
  readRecords().find(record => record.id === taskId);

const updateRecord = (
  taskId: string,
  mutate: (record: IosBackgroundTaskRecord) => IosBackgroundTaskRecord | null,
) => {
  const records = readRecords();
  const index = records.findIndex(record => record.id === taskId);
  if (index < 0) {
    return;
  }
  const next = mutate(records[index]);
  if (next) {
    records[index] = { ...next, updatedAt: Date.now() };
  } else {
    records.splice(index, 1);
  }
  writeRecords(records);
};

// An app restart means no execution loop is running anymore — recover
// interrupted work the same way Android's WorkManager re-enqueues after a
// process death.
const recoverInterruptedTasks = () => {
  const records = readRecords();
  let changed = false;
  for (const record of records) {
    if (record.state === 'running') {
      record.state = 'queued';
      record.updatedAt = Date.now();
      changed = true;
    }
  }
  if (changed) {
    writeRecords(records);
  }
};
recoverInterruptedTasks();

const readSchedule = (key: string): ScheduleConfig | null => {
  const raw = storage.getString(key);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as ScheduleConfig;
  } catch {
    return null;
  }
};

export const iosBackgroundTaskStorage = storage;

export const iosGetDueSchedules = () => {
  const now = Date.now();
  const libraryConfig = readSchedule(LIBRARY_UPDATES_KEY);
  const backupConfig = readSchedule(AUTOMATIC_BACKUPS_KEY);
  const lastLibrary = storage.getNumber(LAST_LIBRARY_UPDATE_KEY) ?? 0;
  const lastBackup = storage.getNumber(LAST_AUTOMATIC_BACKUP_KEY) ?? 0;

  return {
    libraryUpdates: Boolean(
      libraryConfig?.enabled &&
        libraryConfig.intervalHours > 0 &&
        now - lastLibrary >= libraryConfig.intervalHours * 60 * 60 * 1000,
    ),
    automaticBackups: Boolean(
      backupConfig?.enabled &&
        backupConfig.intervalHours > 0 &&
        backupConfig.directoryUri &&
        now - lastBackup >= backupConfig.intervalHours * 60 * 60 * 1000,
    ),
    libraryConfig,
    backupConfig,
  };
};

export const iosMarkScheduleFired = (kind: 'library' | 'backup') => {
  const key =
    kind === 'library' ? LAST_LIBRARY_UPDATE_KEY : LAST_AUTOMATIC_BACKUP_KEY;
  storage.set(key, Date.now());
};

const IosNativeBackgroundTasks = {
  async getTasks() {
    return readRecords()
      .filter(record => !isTerminal(record.state))
      .map(record => ({
        id: record.id,
        type: record.type,
        title: record.title,
        description: record.description,
        state: record.state,
        progress: record.progress,
        progressText: record.progressText,
        attempt: record.attempt,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      }))
      .sort((a, b) => a.createdAt - b.createdAt);
  },

  async getTask(taskId: string) {
    return findRecord(taskId) ?? null;
  },

  async enqueue(
    type: string,
    payload: string,
    title: string,
    description: string,
    _allowsDuplicates: boolean,
    queueName: string,
  ): Promise<string> {
    const record: IosBackgroundTaskRecord = {
      id: makeId(),
      type,
      title,
      description,
      state: 'queued',
      progress: undefined,
      progressText: description,
      attempt: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      payload,
      checkpoint: undefined,
      queueName,
    };
    const records = readRecords();
    records.push(record);
    writeRecords(records);
    return record.id;
  },

  async pause(taskId: string): Promise<void> {
    updateRecord(taskId, record =>
      record.state === 'running' || record.state === 'queued'
        ? { ...record, state: 'paused' }
        : null,
    );
  },

  async resume(taskId: string): Promise<void> {
    updateRecord(taskId, record =>
      record.state === 'paused' ? { ...record, state: 'queued' } : null,
    );
  },

  async cancel(taskId: string): Promise<void> {
    updateRecord(taskId, record =>
      isTerminal(record.state) ? null : { ...record, state: 'cancelled' },
    );
  },

  async updateProgress(
    taskId: string,
    progress: number,
    progressText: string,
  ): Promise<void> {
    updateRecord(taskId, record =>
      isTerminal(record.state)
        ? null
        : {
            ...record,
            state: 'running',
            progress: progress < 0 ? undefined : progress,
            progressText,
          },
    );
  },

  async updateCheckpoint(taskId: string, checkpoint: string): Promise<void> {
    updateRecord(taskId, record =>
      isTerminal(record.state) ? null : { ...record, checkpoint },
    );
  },

  async complete(taskId: string, completionText: string): Promise<void> {
    updateRecord(taskId, record => ({
      ...record,
      state: 'completed',
      description: completionText,
    }));
  },

  async fail(
    taskId: string,
    error: string,
    shouldRetry: boolean,
  ): Promise<void> {
    updateRecord(taskId, record => {
      if (isTerminal(record.state)) {
        return null;
      }
      if (shouldRetry && record.attempt + 1 < MAX_ATTEMPTS) {
        return {
          ...record,
          state: 'queued',
          attempt: record.attempt + 1,
          description: error,
        };
      }
      return { ...record, state: 'failed', description: error };
    });
  },

  async scheduleLibraryUpdates(
    intervalHours: number,
    title: string,
    description: string,
  ): Promise<void> {
    storage.set(
      LIBRARY_UPDATES_KEY,
      JSON.stringify({
        intervalHours,
        title,
        description,
        enabled: true,
      } satisfies ScheduleConfig),
    );
    storage.set(LAST_LIBRARY_UPDATE_KEY, Date.now());
  },

  async cancelLibraryUpdates(): Promise<void> {
    storage.remove(LIBRARY_UPDATES_KEY);
  },

  async scheduleAutomaticBackups(
    intervalHours: number,
    title: string,
    description: string,
    directoryUri: string,
  ): Promise<void> {
    storage.set(
      AUTOMATIC_BACKUPS_KEY,
      JSON.stringify({
        intervalHours,
        title,
        description,
        directoryUri,
        enabled: true,
      } satisfies ScheduleConfig),
    );
    storage.set(LAST_AUTOMATIC_BACKUP_KEY, Date.now());
  },

  async cancelAutomaticBackups(): Promise<void> {
    storage.remove(AUTOMATIC_BACKUPS_KEY);
  },
};

export default IosNativeBackgroundTasks;
