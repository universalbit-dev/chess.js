/**
 * jsonbin_randomchess.js
 *
 * Scheduled uploader for filtered chess log JSON to jsonbin.io
 * Author: universalbit-dev
 */

require('dotenv').config({ quiet: true });

const fs = require('fs-extra');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// ═══════════════════════════════════════════════════════════════════════════
// ─── CONFIGURATION & ROUTING ENVIRONMENTS
// ═══════════════════════════════════════════════════════════════════════════

const INTERVAL = parseInt(process.env.MICROCHESS_UPLOAD_INTERVAL, 10) || 60000; // Check interval (e.g., 1 min)
const ACCESS_KEY = process.env.JSONBIN_ACCESS_KEY;
const BIN_ID = process.env.JSONBIN_BIN_ID; // Your static collection ID

const RANDOMCHESS_PATH = process.env.RANDOMCHESS_PATH
  ? path.resolve(process.env.RANDOMCHESS_PATH)
  : path.resolve(__dirname, 'randomchess.json');

const METADATA_PATH = process.env.METADATA_PATH
  ? path.resolve(process.env.METADATA_PATH)
  : path.resolve(__dirname, 'metadata.json');

if (!ACCESS_KEY || ACCESS_KEY.trim() === '') {
  console.error(`[${new Date().toISOString()}] Error: JSONBIN_ACCESS_KEY is not set.`);
  process.exit(1);
}

let lastProcessedTimestamp = null;

// ═══════════════════════════════════════════════════════════════════════════
// ─── CORE STORAGE SYNC TASK
// ═══════════════════════════════════════════════════════════════════════════

async function syncLogsToCloud() {
  try {
    if (!(await fs.pathExists(RANDOMCHESS_PATH))) return;

    const data = await fs.readJson(RANDOMCHESS_PATH);
    if (!Array.isArray(data) || data.length === 0) return;

    // Grab the latest entry to evaluate if updates are necessary
    const latestGame = data[data.length - 1];
    if (latestGame.timestamp === lastProcessedTimestamp) {
      return; // No new game has been generated since the last check
    }

    // --- DEDUPLICATION LOOP ---
    const seen = new Set();
    const deduped = data.filter(game => {
      if (!game.final_fen) return true;
      if (seen.has(game.final_fen)) return false;
      seen.add(game.final_fen);
      return true;
    });

    // --- DETERMINISTIC ENDPOINT RESOLUTION ---
    let url = 'https://api.jsonbin.io/v3/b';
    let httpMethod = 'POST';
    const headers = {
      'Content-Type': 'application/json',
      'X-Access-Key': ACCESS_KEY
    };

    // If your static BIN_ID exists, convert the stream route to update (PUT) mode
    if (BIN_ID && BIN_ID.trim() !== '') {
      url = `https://api.jsonbin.io/v3/b/${BIN_ID.trim()}`;
      httpMethod = 'PUT';
    } else {
      headers['X-Bin-Private'] = 'true';
    }

    console.log(`[${new Date().toISOString()}] Syncing logs to cloud endpoint using ${httpMethod}...`);

    const response = await fetch(url, {
      method: httpMethod,
      headers: headers,
      body: JSON.stringify(deduped)
    });

    const json = await response.json();

    // Verify response validation constraints
    if (json && (json.record || json.data)) {
      lastProcessedTimestamp = latestGame.timestamp;
      await fs.writeJson(METADATA_PATH, json, { spaces: 2 });
      console.log(`[${new Date().toISOString()}] Persistent cloud sync successful. Method: ${httpMethod}.`);
    } else {
      console.error(`[${new Date().toISOString()}] Cloud storage write warning:`, json);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Critical transport layer error:`, error);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── RUNTIME INITIATION
// ═══════════════════════════════════════════════════════════════════════════

console.log(`[${new Date().toISOString()}] Cloud uploader initialized. Target Bin ID: ${BIN_ID || 'New Container (POST)'}`);
setInterval(syncLogsToCloud, INTERVAL);
syncLogsToCloud();
