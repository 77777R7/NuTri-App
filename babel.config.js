// babel.config.js
module.exports = function (api) {
  api.cache(true);

  return {
    // 注意：这里是 *presets*，nativewind 在这里
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    // 这里才是 plugins，放 expo-router 和 reanimated
    plugins: [

      'react-native-reanimated/plugin', // 一定要放在 plugins 的最后
    ],
  };
};
