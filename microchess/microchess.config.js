// microchess.config.js
module.exports = {
  apps: [
    {
      name: 'microchess-generator',
      script: './microchess.js',
      exec_mode: 'cluster',
      instances: 1,
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'microchess-uploader',
      script: './jsonbin_randomchess.js',
      exec_mode: 'cluster',
      instances: 1,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
