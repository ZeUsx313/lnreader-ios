const { withDangerousMod, withXcodeProject } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const READER_ASSETS_DIR = 'ReaderAssets';

/**
 * Copies the reader WebView runtime (css/js/fonts) into the native project:
 *  - Android: android/app/src/main/assets  → file:///android_asset/...
 *  - iOS:     ios/<project>/ReaderAssets (added to the Resources build phase)
 *             → file://<bundle>/ReaderAssets/...  (see src/utils/readerAssets.ts)
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
      const platformRoot = config.modRequest.platformProjectRoot;
      const projectName =
        config.modRequest.projectName || config.name || 'LNReader';
      const destDir = path.join(platformRoot, projectName, READER_ASSETS_DIR);
      const sourceRoot = path.join(projectRoot, 'assets', 'reader');

      fs.rmSync(destDir, { recursive: true, force: true });
      fs.mkdirSync(destDir, { recursive: true });

      for (const subdir of ['css', 'js', 'fonts']) {
        const src = path.join(sourceRoot, subdir);
        const dest = path.join(destDir, subdir);
        if (fs.existsSync(src)) {
          fs.cpSync(src, dest, { recursive: true });
        }
      }

      return config;
    },
  ]);

  config = withXcodeProject(config, (config) => {
    const xcodeProject = config.modResults;
    const projectName =
      config.modRequest.projectName || config.name || 'LNReader';

    // Folder reference added to the Resources build phase so the whole
    // ReaderAssets tree is copied into the .app bundle during the build.
    xcodeProject.addResourceFile(`"${projectName}/${READER_ASSETS_DIR}"`, {
      last: true,
    });

    return config;
  });

  return config;
};

module.exports = withReaderAssets;
