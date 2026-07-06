const path = require('path');
const webpack = require('webpack');

module.exports = {
  mode: 'production',
  entry: path.resolve(__dirname, 'js/index.js'),
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'dist'),
    library: {
      type: 'module'
    }
  },
  experiments: {
    outputModule: true
  },
  plugins: [

    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify('production'),
      'process.env.JSONBIN_ACCESS_KEY': JSON.stringify(''),
      'process.env.JSONBIN_BIN_ID': JSON.stringify('')
    })
  ],
  optimization: {
    minimize: true
  }
};
