const path = require('path');
const webpack = require('webpack'); // Required to access built-in plugins

module.exports = {
  mode: 'production',
  entry: path.resolve(__dirname, 'js/index.js'), 
  output: {
    path: path.resolve(__dirname, 'dist'),        
    filename: 'bundle.js',                        
    clean: true,
    module: true                                  
  },
  experiments: {
    outputModule: true                            
  },
  externalsType: 'module',
  plugins: [
    // Safely injects the environment secret directly into the compiled bundle
    new webpack.DefinePlugin({
      'process.env.JSONBIN_API_KEY': JSON.stringify(process.env.JSONBIN_API_KEY || '')
    })
  ],
  module: {
    rules: [
      {
        test: /\.css$/i,
        use: ['style-loader', 'css-loader'],      
      },
    ],
  },
};
