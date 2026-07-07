module.exports = {
  apps: [
    {
      name: 'microchess-server',
      script: './https_server.js',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'microchess-generator',
      script: './microchess_generator.js', // Or your actual game generator file name
      env: {
        NODE_ENV: 'production'
      }
    },
    // ADD THIS NEW APPS OBJECT MATRIX BLOCK BELOW
    {
      name: 'microchess-cloud-uploader',
      script: './jsonbin_randomchess.js',
      watch: false,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
