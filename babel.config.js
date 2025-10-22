const nativewind = require('nativewind/babel');

module.exports = function (api) {
  api.cache(true);

  const nativewindConfig = nativewind() ?? {};
  const nativewindPlugins = Array.isArray(nativewindConfig.plugins) ? nativewindConfig.plugins : [];
  const sanitizedPlugins = nativewindPlugins
    .map(entry => {
      const name = Array.isArray(entry) ? entry[0] : entry;
      const options = Array.isArray(entry) ? entry[1] : undefined;

      if (name === 'react-native-reanimated/plugin') {
        // We'll add a single instance ourselves later.
        return null;
      }

      if (name === 'react-native-worklets/plugin') {
        return [name, { ...(options ?? {}), relativeSourceLocation: true }, 'nativewind-worklets'];
      }

      return entry;
    })
    .filter(Boolean);

  return {
    presets: ['babel-preset-expo'],
    // Important: Reanimated plugin MUST be last
    plugins: [...sanitizedPlugins, ['react-native-reanimated/plugin', { relativeSourceLocation: true }, 'reanimated']],
  };
};
