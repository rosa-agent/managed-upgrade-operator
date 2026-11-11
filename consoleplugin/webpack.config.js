const { ConsoleRemotePlugin } = require('@openshift-console/dynamic-plugin-sdk-webpack');
const path = require('path');

module.exports = {
  entry: {},
  context: path.resolve(__dirname, 'src'),
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name]-bundle.js',
    chunkFilename: '[name]-chunk.js',
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
  },
  module: {
    rules: [
      {
        test: /\.(ts|tsx)$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  plugins: [
    new ConsoleRemotePlugin({
      pluginMetadata: require('./plugin.json'),
      validateExtensionIntegrity: false,
    }),
  ],
  devServer: {
    port: 9001,
    static: './dist',
  },
};
