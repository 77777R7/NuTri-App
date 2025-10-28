// babel.config.js

module.exports = function (api) {
  api.cache(true);

  return {
    presets: ['babel-preset-expo', require('nativewind/babel')],
    plugins: [
      // 👉 路径别名配置，可使用 import xxx from "@/components/..."
      [
        'module-resolver',
        {
          root: ['./'],
          alias: {
            '@': './', // 让 @ 指向项目根目录
          },
        },
      ],
      // 👉 Reanimated 必须放在 plugins 数组的最后一项！
      'react-native-reanimated/plugin',
    ],
  };
};
