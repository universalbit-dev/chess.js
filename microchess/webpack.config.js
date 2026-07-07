const path = require('path');
const webpack = require('webpack');

// Automatically read local .env variables if compiling locally
require('dotenv').config({ path: path.resolve(__dirname, '.env'), quiet: true });

module.exports = {
  // Set production mode to automatically optimize, minify, and tree-shake the bundle
  mode: 'production',
  
  // Point strictly to your frontend dashboard user interface engine entry point
  entry: path.resolve(__dirname, 'js/index.js'),
  
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'dist'),
    // Outputs as a clean, modern native ES Module layout
    library: {
      type: 'module'
    }
  },

  experiments: {
    outputModule: true
  },

  plugins: [
    // ═══════════════════════════════════════════════════════════════════════
    // ─── DYNAMIC ENV VARIABLE INJECTION LAYER
    // ═══════════════════════════════════════════════════════════════════════
    // This plugin reads the active environment variables (from local .env or Git Secrets)
    // and physically bakes the text strings right into dist/bundle.js during compilation.
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify('production'),
      'process.env.JSONBIN_ACCESS_KEY': JSON.stringify(process.env.JSONBIN_ACCESS_KEY || ''),
      'process.env.JSONBIN_BIN_ID': JSON.stringify(process.env.JSONBIN_BIN_ID || '')
    })
  ],

  // Production optimization layer to enforce tiny file size footprints and fast browser loads
  optimization: {
    minimize: true
  },

  // Suppress broad bundle performance warnings regarding Chart.js sizes
  performance: {
    hints: false
  }
};
