import { Platform } from 'react-native';

import NativeFile from '@modules/native-file';

/**
 * Base URL prefix for the reader WebView runtime assets (css/js/fonts).
 *
 *  - Dev: served by the metro dev server (works on both platforms).
 *  - Android release: packaged into android/app/src/main/assets by the
 *    withReaderAssets config plugin → file:///android_asset.
 *  - iOS release: packaged as the LNReaderReaderAssets resource bundle by
 *    CocoaPods → file://<main bundle>/LNReaderReaderAssets.bundle.
 */
export const getReaderAssetsPrefix = (): string => {
  if (__DEV__) {
    return 'http://localhost:8081/assets';
  }
  if (Platform.OS === 'ios') {
    return `file://${NativeFile.BundlePath}/LNReaderReaderAssets.bundle`;
  }
  return 'file:///android_asset';
};
