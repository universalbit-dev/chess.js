const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Pre-load environment paths dynamically before PM2 structural validation passes
const envPath = path.resolve(__dirname, '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── RUNTIME INSTANCE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

const apps = [
  {
    name: 'microchess-server',
    script: './https_server.js',
    exec_mode: 'fork',
    instances: 1,
    watch: false,
    max_memory_restart: '300M',
    env: {
      NODE_ENV: 'production'
    }
  },
  {
    name: 'microchess-generator',
    script: './microchess.js',
    exec_mode: 'fork',
    instances: 1,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production'
    }
  }
];

// ═══════════════════════════════════════════════════════════════════════════
// ─── CONDITIONAL CLOUD UPLOADER INJECTION GUARD
// ═══════════════════════════════════════════════════════════════════════════

const hasJsonBinKey = process.env.JSONBIN_ACCESS_KEY && process.env.JSONBIN_ACCESS_KEY.trim() !== '';

if (hasJsonBinKey) {
  apps.push({
    name: 'microchess-uploader',
    script: './jsonbin_randomchess.js',
    exec_mode: 'fork',
    instances: 1,
    watch: false,
    env: {
      NODE_ENV: 'production'
    }
  });
} else {
  // Graceful skip notice printing to your master system terminal shell
  console.log('\x1b[33m%s\x1b[0m', '[PM2 Ecosystem Alert] "JSONBIN_ACCESS_KEY" is empty or missing inside .env.');
  console.log('\x1b[36m%s\x1b[0m', '[PM2 Ecosystem Safe Mode] Bypassed cloud uploader instantiation to prevent fatal runtime loop drops.');
}

module.exports = { apps };
