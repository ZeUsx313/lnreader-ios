import { Platform } from 'react-native';

import NativeFile from '@modules/native-file';

/**
 * Base URL prefix for the reader WebView runtime assets (css/js/fonts).
 *
 *  - Dev: served by the metro dev server (works on both platforms).
 *  - Android release: packaged into android/app/src/main/assets by the
 *    withReaderAssets config plugin → file:///android_asset.
 *  - iOS release: packaged into the app bundle under ReaderAssets/ by the
 *    same plugin → file://<main bundle>/ReaderAssets.
 */
export const getReaderAssetsPrefix = (): string => {
  if (__DEV__) {
    return 'http://localhost:8081/assets';
  }
  if (Platform.OS === 'ios') {
    return `file://${NativeFile.BundlePath}/ReaderAssets`;
  }
  return 'file:///android_asset';
};
