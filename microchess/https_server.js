const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const http = require('http');
const https = require('https');
const net = require('net'); // Node native network verification toolkit

const app = express();
const TARGET_HTTP_PORT = parseInt(process.env.PORT, 10) || 3000;
const TARGET_HTTPS_PORT = parseInt(process.env.HTTPS_PORT, 10) || 3443;

const RANDOMCHESS_PATH = path.resolve(__dirname, 'randomchess.json');
const CERT_KEY_PATH = path.resolve(__dirname, 'certs/server.key');
const CERT_CRT_PATH = path.resolve(__dirname, 'certs/server.crt');

// --- HIGH-PERFORMANCE IN-MEMORY CACHE LAYER ---
let latestGameCache = null;
let customHttpsPort = TARGET_HTTPS_PORT; // Runtime discovery tracker

async function updateEngineCache() {
  try {
    if (!(await fs.pathExists(RANDOMCHESS_PATH))) {
      latestGameCache = { status: "waiting", message: "randomchess.json not found yet." };
      return;
    }
    const rawData = await fs.readFile(RANDOMCHESS_PATH, 'utf8');
    if (!rawData.trim()) return;
    
    const games = JSON.parse(rawData);
    if (Array.isArray(games) && games.length > 0) {
      latestGameCache = games[games.length - 1];
    } else {
      latestGameCache = { status: "waiting", message: "Log array is empty." };
    }
  } catch (err) {
    latestGameCache = { status: "error", message: "Parsing delta sync lag.", details: err.message };
  }
}

updateEngineCache();
fs.watch(__dirname, (eventType, filename) => {
  if (filename === 'randomchess.json') { updateEngineCache(); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ─── MIDDLEWARE & REDIRECT ENGINE (UPDATED FOR DYNAMIC PORTS) ──────────────
// ═══════════════════════════════════════════════════════════════════════════

const redirectApp = express();
redirectApp.use((req, res) => {
  const hostWithNoPort = req.headers.host.split(':')[0];
  // Redirect strictly to the dynamically discovered HTTPS port
  const secureUrl = `https://${hostWithNoPort}:${customHttpsPort}${req.url}`;
  res.redirect(301, secureUrl);
});

app.use(express.static(__dirname));
app.get('/', (req, res) => { res.sendFile(path.resolve(__dirname, 'microchess.html')); });
app.get('/api/live-game', (req, res) => { res.json(latestGameCache || { status: "initializing" }); });

// ═══════════════════════════════════════════════════════════════════════════
// ─── PORT AVAILABILITY PROBE LAYER ────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tests a target port socket and scans upward if already bound
 */
function findAvailablePort(startPort) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(findAvailablePort(startPort + 1)); // Increment scan fallback
      }
    });
    server.once('listening', () => {
      server.close(() => resolve(startPort)); // Port free, release and resolve
    });
    server.listen(startPort);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── ASYNCHRONOUS SERVER INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════

(async function bootSecureStack() {
  if (!fs.existsSync(CERT_KEY_PATH) || !fs.existsSync(CERT_CRT_PATH)) {
    console.error(`[Critical Error] Security assets missing inside ./certs/. Please run ./make-certs.sh first.`);
    process.exit(1);
  }

  try {
    // Audit active socket availability dynamically
    const finalHttpPort = await findAvailablePort(TARGET_HTTP_PORT);
    customHttpsPort = await findAvailablePort(TARGET_HTTPS_PORT);

    const sslOptions = {
      key: fs.readFileSync(CERT_KEY_PATH),
      cert: fs.readFileSync(CERT_CRT_PATH)
    };

    // Spin up secure channel logic
    https.createServer(sslOptions, app).listen(customHttpsPort, () => {
      console.log(`\x1b[32m%s\x1b[0m`, `[HTTPS Context] Enforced Secure Connection: https://localhost:${customHttpsPort}`);
    });

    // Spin up unsecure channel listener purely to catch and redirect incoming connections
    http.createServer(redirectApp).listen(finalHttpPort, () => {
      console.log(`\x1b[33m%s\x1b[0m`, `[HTTP Redirector] Routing unsecure entries from port ${finalHttpPort} -> ${customHttpsPort}`);
    });

  } catch (sslErr) {
    console.error(`[SSL Error] Key compilation crash: ${sslErr.message}`);
    process.exit(1);
  }
})();
