const path = require('path');

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
  optimization: {
    minimize: true
  }
};
