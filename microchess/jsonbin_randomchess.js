/**
 * jsonbin_randomchess.js
 *
 * Scheduled uploader for filtered chess log JSON to jsonbin.io
 *
 * Author: universalbit-dev
 */

require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Load config from .env or use defaults

/*
| MICROCHESS_INTERVAL (ms) | Interval         | Example use           |
|--------------------------|------------------|-----------------------|
|        60000             | 1 minute         | Fast testing          |
|      3600000             | 1 hour (default) | Normal production     |
|    86400000              | 24 hours         | Daily upload          |

Set in .env to control upload/game frequency, e.g.:
MICROCHESS_INTERVAL=3600000  // every hour
*/

const INTERVAL = parseInt(process.env.MICROCHESS_INTERVAL, 10) || 3600000; 
const ACCESS_KEY = process.env.JSONBIN_ACCESS_KEY;
const RANDOMCHESS_PATH = process.env.RANDOMCHESS_PATH
  ? path.resolve(process.env.RANDOMCHESS_PATH)
  : path.resolve(__dirname, 'randomchess.json');
const METADATA_PATH = process.env.METADATA_PATH
  ? path.resolve(process.env.METADATA_PATH)
  : path.resolve(__dirname, 'metadata.json');

if (!ACCESS_KEY || ACCESS_KEY.trim() === '') {
  console.error('Error: JSONBIN_ACCESS_KEY is not set in .env.');
  process.exit(1);
}

async function uploadRandomChess() {
  try {
    if (!fs.existsSync(RANDOMCHESS_PATH)) {
      console.error(`[${new Date().toISOString()}] File not found: ${RANDOMCHESS_PATH}`);
      return;
    }
    // --- DEDUPLICATION LOGIC START ---
    const raw = await fs.readFile(RANDOMCHESS_PATH, 'utf8');
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.error(`[${new Date().toISOString()}] Invalid JSON in ${RANDOMCHESS_PATH}`);
      return;
    }
    if (!Array.isArray(data)) {
      console.error(`[${new Date().toISOString()}] Data in ${RANDOMCHESS_PATH} is not an array.`);
      return;
    }
    // Deduplicate by 'fen' property (change if you have a different key)
    const seen = new Set();
    const deduped = data.filter(game => {
      if (!game.fen) return true; // If no key, keep (or adjust as needed)
      if (seen.has(game.fen)) return false;
      seen.add(game.fen);
      return true;
    });
    // --- DEDUPLICATION LOGIC END ---

    const response = await fetch('https://api.jsonbin.io/v3/b', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Access-Key': ACCESS_KEY,
        'X-Bin-Private': 'true'
      },
      body: JSON.stringify(deduped)
    });

    const json = await response.json();

    if (json && json.record) {
      await fs.writeJson(METADATA_PATH, json, { spaces: 2 });
      console.log(`[${new Date().toISOString()}] Upload successful. Metadata saved to ${METADATA_PATH}.`);
    } else {
      console.error(`[${new Date().toISOString()}] Upload failed:`, json);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Upload error:`, error);
  }
}

console.log(`Uploader started. Uploading every ${INTERVAL / 1000}s...`);
uploadRandomChess(); // Run immediately at start
setInterval(uploadRandomChess, INTERVAL);
