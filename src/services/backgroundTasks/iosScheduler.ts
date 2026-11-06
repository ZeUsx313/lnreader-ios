import { Platform } from 'react-native';

import NativeBackgroundTasks, {
  iosGetDueSchedules,
  iosMarkScheduleFired,
  type NativeBackgroundTaskRecord,
} from '@modules/native-background-tasks';
import { backgroundTasks } from './backgroundTasks';
import type { BackgroundTask } from './contracts';
import { MAX_CONCURRENT_DOWNLOADS } from './taskDefinitions';

const downloadQueueRegex = /^lnreader-background-task:download:/;

/**
 * Drives background-task execution on iOS.
 *
 * The native Android module launches WorkManager workers which boot a
 * headless JS runtime. That is impossible on iOS, so the queue is drained
 * in-process: persisted tasks run through the same BackgroundTaskQueue.run
 * pipeline the headless entrypoint uses, honouring the per-plugin download
 * lanes (max MAX_CONCURRENT_DOWNLOADS) and one-lane-per-task-type
 * serialization. Tasks killed mid-run are reset to 'queued' by
 * IosNativeBackgroundTasks on the next launch and resume from checkpoint.
 */
class IosTaskScheduler {
  private draining = false;

  drain = async () => {
    if (Platform.OS !== 'ios' || this.draining) {
      return;
    }
    this.draining = true;
    try {
      for (;;) {
        const next = await this.pickNextTask();
        if (!next) {
          return;
        }

        // Claim the task immediately so concurrent drains never double-pick.
        await NativeBackgroundTasks.updateProgress(next.id, -1, '');

        const task = JSON.parse(next.payload) as BackgroundTask;
        // Intentionally not awaited: independent lanes run in parallel and
        // re-trigger a drain when they finish.
        backgroundTasks
          .run(next.id, task, next.checkpoint)
          .catch(() => undefined)
          .finally(() => {
            void this.drain();
          });
      }
    } catch {
      // Queue reads failing should never crash the app; the next drain
      // attempt (enqueue/resume/launch) retries.
    } finally {
      this.draining = false;
    }
  };

  /**
   * Runs schedules that became due while the app was closed/foregrounded.
   * Android performs this via WorkManager periodic work; on iOS the check
   * happens on app start.
   */
  checkSchedules = async () => {
    if (Platform.OS !== 'ios') {
      return;
    }
    try {
      const due = iosGetDueSchedules();
      const tasks: BackgroundTask[] = [];

      if (due.libraryUpdates) {
        iosMarkScheduleFired('library');
        tasks.push({
          name: 'UPDATE_LIBRARY',
          data: {},
        });
      }

      if (due.automaticBackups && due.backupConfig?.directoryUri) {
        iosMarkScheduleFired('backup');
        tasks.push({
          name: 'LOCAL_BACKUP',
          data: {
            destinationUri: due.backupConfig.directoryUri,
            automatic: true,
          },
        });
      }

      if (tasks.length > 0) {
        backgroundTasks.enqueue(tasks);
      }
    } catch {
      // Scheduling is best-effort.
    }
  };

  private async pickNextTask(): Promise<NativeBackgroundTaskRecord | null> {
    const summaries = await NativeBackgroundTasks.getTasks();
    const records: NativeBackgroundTaskRecord[] = [];
    for (const summary of summaries) {
      const record = await NativeBackgroundTasks.getTask(summary.id);
      if (record) {
        records.push(record);
      }
    }

    const activeRecords = records.filter(
      record => record.state === 'running' || record.state === 'queued',
    );
    const busyLanes = activeRecords
      .filter(record => record.state === 'running')
      .map(record => record.queueName ?? '');
    const downloadLanes = new Set(
      busyLanes.filter(lane => downloadQueueRegex.test(lane)),
    );
    if (downloadLanes.size >= MAX_CONCURRENT_DOWNLOADS) {
      return null;
    }

    for (const record of records) {
      if (record.state !== 'queued') {
        continue;
      }
      const lane = record.queueName ?? '';
      if (busyLanes.includes(lane)) {
        continue;
      }
      if (
        downloadQueueRegex.test(lane) &&
        downloadLanes.size >= MAX_CONCURRENT_DOWNLOADS
      ) {
        continue;
      }
      return record;
    }
    return null;
  }
}

export const iosTaskScheduler = new IosTaskScheduler();
