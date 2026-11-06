const { withDangerousMod, withXcodeProject, withPodfile } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const READER_ASSETS_DIR = 'ReaderAssets';

/**
 * Packages the reader WebView runtime (css/js/fonts) into the native project:
 *  - Android: copied to android/app/src/main/assets → file:///android_asset/...
 *  - iOS: copied to ios/<project>/ReaderAssets and registered as a FOLDER
 *    REFERENCE in the Xcode Resources build phase → the whole directory is
 *    copied into <App>.app/ReaderAssets (see src/utils/readerAssets.ts).
 *
 * iOS note: node-xcode's addResourceFile crashes on Expo 57's generated
 * project because there is no 'Resources' PBXGroup — we create it first, and
 * force lastKnownFileType=folder so Xcode copies the directory as-is.
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

    // Expo 57's generated project has no 'Resources' PBXGroup, and
    // addResourceFile dereferences it unconditionally — create it first.
    if (!xcodeProject.pbxGroupByName('Resources')) {
      const mainGroupUuid = xcodeProject.getFirstProject().firstProject
        .mainGroup;
      const { uuid } = xcodeProject.addPbxGroup([], 'Resources');
      xcodeProject.addToPbxGroup(uuid, mainGroupUuid);
    }

    const file = xcodeProject.addResourceFile(
      `"${projectName}/${READER_ASSETS_DIR}"`,
      { last: true },
    );

    if (file && file.fileRef) {
      // Force folder-reference semantics so Xcode copies the directory
      // verbatim into the .app bundle.
      const ref =
        xcodeProject.hash.project.objects.PBXFileReference[file.fileRef];
      ref.name = READER_ASSETS_DIR;
      ref.path = `${projectName}/${READER_ASSETS_DIR}`;
      ref.sourceTree = '<group>';
      ref.lastKnownFileType = 'folder';
      delete ref.explicitFileType;
      delete ref.fileEncoding;
    }

    return config;
  });

  config = withPodfile(config, (config) => {
    const contents = config.modResults.contents;

    // Target-scoped directive: Swift pods pulled in transitively by
    // @react-native-google-signin (AppCheckCore → GoogleUtilities /
    // RecaptchaInterop) require modular headers as static libraries.
    // Must live INSIDE the app target block.
    if (!/^\s*use_expo_modules!/m.test(contents)) {
      throw new Error(
        'Podfile: expected use_expo_modules! inside the app target block',
      );
    }
    if (!contents.includes('use_modular_headers!')) {
      config.modResults.contents = contents.replace(
        /^(\s*)use_expo_modules!$/m,
        match => `${match}\nuse_modular_headers!`,
      );
    }
    return config;
  });

  return config;
};

module.exports = withReaderAssets;
