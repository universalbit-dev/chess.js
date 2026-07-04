/**
 * jsonbin_randomchess.js
 *
 * Scheduled uploader for filtered chess log JSON to jsonbin.io
 * Enhanced with quiet environment logging and dynamic directory resolution paths.
 *
 * Author: universalbit-dev
 */

// Pass quiet: true to completely suppress the console injection logs and tips
require('dotenv').config({ quiet: true });

const fs = require('fs-extra');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// ═══════════════════════════════════════════════════════════════════════════
// ─── DYNAMIC DIRECTORY RESOLUTION LAYER
// ═══════════════════════════════════════════════════════════════════════════

const INTERVAL = parseInt(process.env.MICROCHESS_UPLOAD_INTERVAL, 10) || 3600000; 
const ACCESS_KEY = process.env.JSONBIN_ACCESS_KEY;

// Force path evaluation to bind strictly to execution context folder dynamically
const RANDOMCHESS_PATH = process.env.RANDOMCHESS_PATH
  ? path.resolve(process.env.RANDOMCHESS_PATH)
  : path.resolve(__dirname, 'randomchess.json');

const METADATA_PATH = process.env.METADATA_PATH
  ? path.resolve(process.env.METADATA_PATH)
  : path.resolve(__dirname, 'metadata.json');

if (!ACCESS_KEY || ACCESS_KEY.trim() === '') {
  console.error(`[${new Date().toISOString()}] Error: JSONBIN_ACCESS_KEY is not set in .env.`);
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── CORE UPLOADER ENGINE
// ═══════════════════════════════════════════════════════════════════════════

async function uploadRandomChess() {
  try {
    if (!fs.existsSync(RANDOMCHESS_PATH)) {
      console.error(`[${new Date().toISOString()}] Target sync matrix missed. File not found at: ${RANDOMCHESS_PATH}`);
      return;
    }
    
    const raw = await fs.readFile(RANDOMCHESS_PATH, 'utf8');
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.error(`[${new Date().toISOString()}] Invalid JSON formatting signature found in: ${RANDOMCHESS_PATH}`);
      return;
    }
    
    if (!Array.isArray(data)) {
      console.error(`[${new Date().toISOString()}] File compilation structural error: Top-level data is not an array.`);
      return;
    }

    // --- DEDUPLICATION PROCESSING LOOP ---
    const seen = new Set();
    const deduped = data.filter(game => {
      if (!game.fen) return true; 
      if (seen.has(game.fen)) return false;
      seen.add(game.fen);
      return true;
    });

    // --- OUTBOUND SYNC PIPELINE ---
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
      console.log(`[${new Date().toISOString()}] Cloud sync successful. Meta records compiled into: ${METADATA_PATH}`);
    } else {
      console.error(`[${new Date().toISOString()}] Cloud storage drop warning:`, json);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Critical transport layer error:`, error);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── RUNTIME INITIATION
// ═══════════════════════════════════════════════════════════════════════════

console.log(`Uploader engine initialized. Target frequency configuration: every ${INTERVAL / 1000}s.`);
uploadRandomChess(); // Direct immediate sync test on process spin-up
setInterval(uploadRandomChess, INTERVAL);
