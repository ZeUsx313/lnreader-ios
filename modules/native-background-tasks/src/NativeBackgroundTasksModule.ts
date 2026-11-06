import { Platform } from 'react-native';

import { requireNativeModule } from 'expo-modules-core';

import IosNativeBackgroundTasks from './IosNativeBackgroundTasks';

export type NativeBackgroundTaskSummary = {
  id: string;
  type: string;
  title: string;
  description?: string;
  state: string;
  progress?: number;
  progressText?: string;
  attempt: number;
  createdAt: number;
  updatedAt: number;
};

export type NativeBackgroundTaskRecord = NativeBackgroundTaskSummary & {
  payload: string;
  checkpoint?: string;
  /** Execution lane (queue) the task belongs to. Present on iOS records. */
  queueName?: string;
};

type NativeBackgroundTasksModule = {
  getTasks(): Promise<NativeBackgroundTaskSummary[]>;
  getTask(taskId: string): Promise<NativeBackgroundTaskRecord | null>;

  enqueue(
    type: string,
    payload: string,
    title: string,
    description: string,
    allowsDuplicates: boolean,
    queueName: string,
  ): Promise<string>;
  pause(taskId: string): Promise<void>;
  resume(taskId: string): Promise<void>;
  cancel(taskId: string): Promise<void>;
  updateProgress(
    taskId: string,
    progress: number,
    progressText: string,
  ): Promise<void>;
  updateCheckpoint(taskId: string, checkpoint: string): Promise<void>;
  complete(taskId: string, completionText: string): Promise<void>;
  fail(taskId: string, error: string, shouldRetry: boolean): Promise<void>;
  scheduleLibraryUpdates(
    intervalHours: number,
    title: string,
    description: string,
  ): Promise<void>;
  cancelLibraryUpdates(): Promise<void>;
  scheduleAutomaticBackups(
    intervalHours: number,
    title: string,
    description: string,
    directoryUri: string,
  ): Promise<void>;
  cancelAutomaticBackups(): Promise<void>;
};

/**
 * Android uses the native WorkManager-backed module. iOS uses an equivalent
 * in-runtime implementation (MMKV-persisted queue driven by the foreground
 * app). See IosNativeBackgroundTasks.ts and docs/ios-port for the trade-offs
 * (React Native has no headless-JS equivalent on iOS).
 */
export default Platform.OS === 'android'
  ? requireNativeModule<NativeBackgroundTasksModule>('NativeBackgroundTasks')
  : (IosNativeBackgroundTasks as NativeBackgroundTasksModule);

export {
  iosBackgroundTaskStorage,
  iosGetDueSchedules,
  iosMarkScheduleFired,
} from './IosNativeBackgroundTasks';
