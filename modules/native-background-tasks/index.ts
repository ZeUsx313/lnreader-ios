import NativeBackgroundTasks, {
  NativeBackgroundTaskRecord,
  NativeBackgroundTaskSummary,
} from './src/NativeBackgroundTasksModule';

export default NativeBackgroundTasks;
export { NativeBackgroundTaskRecord, NativeBackgroundTaskSummary };
export {
  iosBackgroundTaskStorage,
  iosGetDueSchedules,
  iosMarkScheduleFired,
} from './src/IosNativeBackgroundTasks';
