const { withDangerousMod, withPodfile } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const READER_ASSETS_DIR = 'ReaderAssets';
const ASSETS_POD_DIR = 'reader-assets-ios';
const RESOURCE_BUNDLE_NAME = 'LNReaderReaderAssets';

/**
 * Packages the reader WebView runtime (css/js/fonts) into the native project:
 *  - Android: copied to android/app/src/main/assets → file:///android_asset/...
 *  - iOS: copied to <root>/reader-assets-ios/ReaderAssets and packaged as the
 *    LNReaderReaderAssets.resource bundle via CocoaPods → the files land in
 *    <mainBundle>/LNReaderReaderAssets.bundle (see src/utils/readerAssets.ts).
 *
 * The pod route is used instead of Xcode project edits because resource
 * bundles are deterministic under `expo prebuild` (no PBX surgery).
 */
const withReaderAssets = (config) => {
  config = withDangerousMod(config, [
    'android',
    (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const platformRoot = config.modRequest.platformProjectRoot;
      const assetsDir = path.join(platformRoot, 'app', 'src', 'main', 'assets');
      const sourceRoot = path.join(projectRoot, 'assets', 'reader');

      fs.mkdirSync(assetsDir, { recursive: true });

      for (const subdir of ['css', 'js', 'fonts']) {
        const src = path.join(sourceRoot, subdir);
        const dest = path.join(assetsDir, subdir);
        if (fs.existsSync(src)) {
          fs.cpSync(src, dest, { recursive: true });
        }
      }

      return config;
    },
  ]);

  config = withDangerousMod(config, [
    'ios',
    (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const podDir = path.join(projectRoot, ASSETS_POD_DIR, READER_ASSETS_DIR);
      const sourceRoot = path.join(projectRoot, 'assets', 'reader');

      fs.rmSync(podDir, { recursive: true, force: true });
      fs.mkdirSync(podDir, { recursive: true });

      for (const subdir of ['css', 'js', 'fonts']) {
        const src = path.join(sourceRoot, subdir);
        const dest = path.join(podDir, subdir);
        if (fs.existsSync(src)) {
          fs.cpSync(src, dest, { recursive: true });
        }
      }

      return config;
    },
  ]);

  config = withPodfile(config, (config) => {
    const marker = 'LNReaderReaderAssets';
    if (!config.modResults.contents.includes(marker)) {
      config.modResults.contents +=
        `\n# Reader WebView runtime assets bundle (iOS port — see plugins/withReaderAssets.js)\n` +
        `pod '${RESOURCE_BUNDLE_NAME}', :path => '../${ASSETS_POD_DIR}'\n`;
    }
    return config;
  });

  return config;
};

module.exports = withReaderAssets;
