const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
// lucide-react-native ships as ESM-first (.mjs files) with a package.json
// "exports" map — Metro's default resolver doesn't follow that map or the
// .mjs extension out of the box, causing "Unable to resolve module
// ./icons/a-arrow-down.mjs" errors. This is Metro's documented fix.
const config = {
  resolver: {
    unstable_enablePackageExports: true,
    sourceExts: ['mjs', 'js', 'jsx', 'json', 'ts', 'tsx']
  }
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
