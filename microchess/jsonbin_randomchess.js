/**
 * jsonbin_randomchess.js (Synchronizer)
 *
 * Captures the persistent history array of your neural engine
 * and mirrors it safely to JSONBin for dashboard delivery.
 */

require('dotenv').config({ quiet: true });

const fs = require('fs-extra');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// ═══════════════════════════════════════════════════════════════════════════
// ─── CONFIGURATION & ROUTING ENVIRONMENTS
// ═══════════════════════════════════════════════════════════════════════════
const INTERVAL = parseInt(process.env.MICROCHESS_UPLOAD_INTERVAL, 10) || 60000; // 1 min sync check
const ACCESS_KEY = process.env.JSONBIN_ACCESS_KEY;
const BIN_ID = process.env.JSONBIN_BIN_ID; // Mandatory: Extracted exclusively from environment configuration layers

const RANDOMCHESS_PATH = process.env.RANDOMCHESS_PATH
  ? path.resolve(process.env.RANDOMCHESS_PATH)
  : path.resolve(__dirname, 'randomchess.json');

const METADATA_PATH = process.env.METADATA_PATH
  ? path.resolve(process.env.METADATA_PATH)
  : path.resolve(__dirname, 'metadata.json');

// Rigid validation boundaries on boot pass
if (!ACCESS_KEY || ACCESS_KEY.trim() === '') {
  console.error(`[${new Date().toISOString()}] Critical Error: JSONBIN_ACCESS_KEY is not configured inside .env or environments.`);
  process.exit(1);
}

if (!BIN_ID || BIN_ID.trim() === '') {
  console.error(`[${new Date().toISOString()}] Critical Error: JSONBIN_BIN_ID is not configured inside .env or environments.`);
  process.exit(1);
}

let lastProcessedTimestamp = null;

console.log(`[${new Date().toISOString()}] Cloud uploader initialized using environment variables.`);

// ═══════════════════════════════════════════════════════════════════════════
// ─── SYNC EXECUTION ENGINE
// ═══════════════════════════════════════════════════════════════════════════
async function syncTelemetryWithCloudBin() {
  try {
    if (!(await fs.pathExists(RANDOMCHESS_PATH))) {
      return; // Await file creation by generator daemon
    }

    const records = await fs.readJson(RANDOMCHESS_PATH);
    if (!Array.isArray(records) || records.length === 0) {
      return;
    }

    const latestGame = records[records.length - 1];

    // Only hit your API quota if a brand new neural game has actually been added
    if (lastProcessedTimestamp && latestGame.timestamp === lastProcessedTimestamp) {
      return; 
    }

    // ⚡ FIXED ARCHITECTURE: Send the clean 30-game history array 
    // This keeps the file small while ensuring the dashboard never loads blank lines!
    let deduped = Array.from(records);
    if (deduped.length > 30) {
      deduped = deduped.slice(-30);
    }

    const url = `https://api.jsonbin.io/v3/b/${BIN_ID.trim()}`;
    const httpMethod = 'PUT';
    const headers = {
      'Content-Type': 'application/json',
      'X-Access-Key': ACCESS_KEY.trim()
    };

    console.log(`[${new Date().toISOString()}] Syncing logs to cloud endpoint using ${httpMethod}...`);

    const response = await fetch(url, {
      method: httpMethod,
      headers: headers,
      body: JSON.stringify(deduped)
    });

    const json = await response.json();

    if (json && (json.record || json.data)) {
      lastProcessedTimestamp = latestGame.timestamp;
      await fs.writeJson(METADATA_PATH, json, { spaces: 2 });
      console.log(`[${new Date().toISOString()}] Persistent cloud sync successful. Method: ${httpMethod}.`);
    } else {
      console.error(`[${new Date().toISOString()}] Cloud storage write warning:`, json);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Critical transport layer error:`, error.message);
  }
}

// Start continuous execution loop tracking
syncTelemetryWithCloudBin();
setInterval(syncTelemetryWithCloudBin, INTERVAL);
