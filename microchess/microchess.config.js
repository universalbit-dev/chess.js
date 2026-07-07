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
      script: './microchess.js',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'microchess-cloud-uploader',
      script: './jsonbin_randomchess.js',
      watch: false,
      env: {
        NODE_ENV: 'production',
        JSONBIN_ACCESS_KEY: process.env.JSONBIN_ACCESS_KEY,
        JSONBIN_BIN_ID: process.env.JSONBIN_BIN_ID
      }
    }
  ]
};
