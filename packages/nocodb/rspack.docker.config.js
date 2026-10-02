const { resolve } = require('path');
const nodeExternals = require('webpack-node-externals');
const { TsCheckerRspackPlugin } = require('ts-checker-rspack-plugin');
const base = require('./rspack.config');

module.exports = {
  ...base,
  entry: './src/run/dockerEntry.ts',
  output: {
    path: resolve(__dirname, 'dist'),
    filename: 'main.js',
    libraryTarget: 'commonjs2',
    clean: true,
  },
  resolve: {
    ...base.resolve,
    alias: {
      '@noco-local-integrations/core$': resolve(
        __dirname,
        '../noco-integrations/core/src/index.ts',
      ),
      ...base.resolve.alias,
    },
  },
  externals: [nodeExternals({ allowlist: ['nocodb-sdk', 'ipaddr.js'] })],
  plugins: base.plugins.map((plugin) =>
    plugin instanceof TsCheckerRspackPlugin
      ? new TsCheckerRspackPlugin({
          typescript: { configFile: resolve(__dirname, 'tsconfig.build.json') },
        })
      : plugin,
  ),
};
