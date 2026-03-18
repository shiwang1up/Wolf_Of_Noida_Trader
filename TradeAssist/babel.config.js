module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'react-native-unistyles/plugin',
        {
          // Root folder of your application - all files under this folder
          // will be processed by the Babel plugin
          root: 'app',
        },
      ],
      'react-native-reanimated/plugin',
    ],
  };
};
