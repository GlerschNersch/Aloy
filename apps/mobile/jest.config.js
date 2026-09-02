// The default preset's transformIgnorePatterns only whitelists
// react-native/@react-native(-community) packages — every other RN-ecosystem
// dependency here ships untranspiled ESM and needs to be added explicitly or
// Jest throws "Cannot use import statement outside a module".
//
// The preset's own `transform` regex also only matches .js/.ts/.tsx — it
// misses lucide-react-native's .mjs files, which then hit Jest untransformed
// and throw "Unexpected token 'export'" even once un-ignored above. Re-declare
// transform here with .mjs/.jsx added, keeping the preset's asset transformer.
module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['./jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-native-async-storage|lucide-react-native|react-native-markdown-display|react-native-safe-area-context|react-native-svg|react-native-tts|react-native-audio-recorder-player|react-native-image-picker|@notifee)/)'
  ],
  transform: {
    '^.+\\.(js|jsx|mjs|ts|tsx)$': 'babel-jest',
    '^.+\\.(bmp|gif|jpg|jpeg|mp4|png|psd|svg|webp)$': require.resolve('@react-native/jest-preset/jest/assetFileTransformer.js')
  }
};
