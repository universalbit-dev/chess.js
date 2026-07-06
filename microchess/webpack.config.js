const path = require('path');
const webpack = require('webpack');

module.exports = {
  // Set production mode to automatically optimize and minify bundle.js
  mode: 'production',
  
  // Point to your newly updated static index.js file
  entry: path.resolve(__dirname, 'js/index.js'),
  
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'dist'),
    // Outputs as a clean modern ES module structure
    library: {
      type: 'module'
    }
  },

  experiments: {
    outputModule: true
  },

  // Prevents Webpack from failing if process.env isn't fully defined in a static context
  plugins: [
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify('production')
    })
  ],

  // Optimization layer to keep build speeds blazing fast under 1 second
  optimization: {
    minimize: true
  }
};
