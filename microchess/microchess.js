/**
 * microchess.js
 *
 * Generates periodic random chess games and appends them to a JSON file.
 *
 * Features:
 * - Uses chess.js to generate legal random games (configurable max plies).
 * - Atomic file writes (write to temp file then rename) with retry/backoff.
 * - Optional reproducible RNG support (mulberry32 built-in or optional seedrandom).
 * - Rotating winston logger to console and a log file.
 * - Graceful shutdown to attempt a final run on SIGINT/SIGTERM.
 * - Environment-driven configuration for flexible deployment.
 *
 * Usage:
 *  - Install dependencies: npm install
 *  - Optionally install seedrandom to use the package RNG:
 *      npm install seedrandom
 *  - Configure environment via .env or environment variables (see .env.example)
 *  - Run: node microchess.js
 *
 * Note on reproducibility:
 *  - If MICROCHESS_SEED is provided, the run will be deterministic (same seed + same code yields same moves).
 *  - If MICROCHESS_SEED is absent, a cryptographic seed is generated per-run and saved with the entry for later replay.
 *  - If MICROCHESS_USE_SEEDRANDOM=true and seedrandom is installed, seedrandom() will be used for RNG.
 *
 * Safety and assumptions:
 *  - Intended for non-cryptographic randomness and reproducibility only.
 *  - Determinism depends on chess.js behavior and its version; keep library versions stable for replayability.
 *
 * Environment variables (brief):
 *  - MICROCHESS_OUTPUT_FILE        Path to JSON output (default: ./randomchess.json)
 *  - MICROCHESS_LOG_FILE           Path to logger file (default: ./microchess.log)
 *  - MICROCHESS_MAX_SIZE_BYTES     Max bytes for output JSON (default: 1048576)
 *  - MICROCHESS_GENERATOR_INTERVAL Interval between runs in ms (default: 3600000)
 *  - MICROCHESS_MAX_MOVES         Max plies (half-moves) per game (default: 100)
 *  - MICROCHESS_MAX_WRITE_RETRIES  Write retry attempts (default: 3)
 *  - MICROCHESS_LOG_LEVEL          winston log level (default: info)
 *  - MICROCHESS_RUN_ONCE           If "true", run once and exit (default: false)
 *  - MICROCHESS_USE_SEEDRANDOM     If "true", use seedrandom package if installed (default: false)
 *  - MICROCHESS_SEED               Optional seed string for deterministic runs (default: generated per-run)
 *
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const fs = require('fs');
const os = require('os');
const { promisify } = require('util');
const writeFile = promisify(fs.writeFile);
const rename = promisify(fs.rename);
const stat = promisify(fs.stat);
const readFile = promisify(fs.readFile);
const unlink = promisify(fs.unlink);
const winston = require('winston');
const crypto = require('crypto');
const { Chess } = require('../dist/cjs/chess.js');

//
// Configuration (environment or defaults)
//
const OUTPUT_FILE = process.env.MICROCHESS_OUTPUT_FILE
  ? path.resolve(process.env.MICROCHESS_OUTPUT_FILE)
  : path.join(__dirname, 'randomchess.json');

const LOG_FILE = process.env.MICROCHESS_LOG_FILE
  ? path.resolve(process.env.MICROCHESS_LOG_FILE)
  : path.join(__dirname, 'microchess.log');

const MAX_SIZE_BYTES = parseInt(process.env.MICROCHESS_MAX_SIZE_BYTES, 10) || 1 * 1024 * 1024;
const GENERATOR_INTERVAL = parseInt(process.env.MICROCHESS_GENERATOR_INTERVAL, 10) || 3600000;
const MAX_MOVES = parseInt(process.env.MICROCHESS_MAX_MOVES, 10) || 100;
const MAX_WRITE_RETRIES = parseInt(process.env.MICROCHESS_MAX_WRITE_RETRIES, 10) || 3;
const LOG_LEVEL = process.env.MICROCHESS_LOG_LEVEL || 'info';
const RUN_ONCE = (process.env.MICROCHESS_RUN_ONCE || 'false').toLowerCase() === 'true';
const TRIM_STRATEGY = process.env.MICROCHESS_TRIM_STRATEGY || 'drop-oldest'; // reserved for future

//
// Logger
//
const logger = winston.createLogger({
  level: LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level}] ${message}`)
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: LOG_FILE, maxsize: 10 * 1024 * 1024, maxFiles: 5 })
  ],
});

//
// Helper: atomic write (write to temp then rename)
//
async function atomicWriteJson(filePath, data) {
  const tmpPath = `${filePath}.${Date.now()}.${process.pid}.tmp`;
  const json = JSON.stringify(data, null, 2) + os.EOL;
  await writeFile(tmpPath, json, { encoding: 'utf8' });
  await rename(tmpPath, filePath);
}

//
// Load existing logs (safe)
//
async function loadLogs() {
  try {
    if (fs.existsSync(OUTPUT_FILE)) {
      const data = await readFile(OUTPUT_FILE, 'utf8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) return parsed;
      logger.warn('Existing output file did not contain a top-level array — resetting.');
    }
  } catch (err) {
    logger.warn(`Failed to load logs (${err && err.message ? err.message : err}). Starting fresh.`);
  }
  return [];
}

//
// Trim logs to ensure file size under MAX_SIZE_BYTES
// Efficiently drop oldest entries until fit.
// Returns new array (mutated copy).
//
function trimLogsToFitSize(logs) {
  // Fast path: if already small enough, return.
  try {
    let json = JSON.stringify(logs, null, 2);
    while (Buffer.byteLength(json, 'utf8') > MAX_SIZE_BYTES && logs.length > 0) {
      // Remove oldest entries first
      logs.shift();
      json = JSON.stringify(logs, null, 2);
    }
  } catch (err) {
    logger.error(`Error while trimming logs: ${err && err.message ? err.message : err}`);
    // In case of error, keep logs as-is (fallback)
  }
  return logs;
}

//
// Write logs with retries to handle rare write contention or transient errors.
//
async function writeLogsWithRetries(logs) {
  let attempt = 0;
  const toWrite = trimLogsToFitSize(Array.from(logs));
  while (attempt < MAX_WRITE_RETRIES) {
    try {
      await atomicWriteJson(OUTPUT_FILE, toWrite);
      return;
    } catch (err) {
      attempt++;
      logger.warn(`Attempt ${attempt} failed to write logs: ${err && err.message ? err.message : err}`);
      if (attempt >= MAX_WRITE_RETRIES) {
        logger.error('Exceeded maximum write retries — giving up for this run.');
        throw err;
      }
      // small backoff
      await new Promise((res) => setTimeout(res, 100 * attempt));
    }
  }
}

//
// Simple seeded RNG options (mulberry32 fallback or optional seedrandom)
//

// string -> 32-bit integer hash (xfnv1a)
function xfnv1a(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32 PRNG returning function() -> float in [0,1)
function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

let seedrandomAvailable = false;
let seedrandomPkg = null;
if ((process.env.MICROCHESS_USE_SEEDRANDOM || '').toLowerCase() === 'true') {
  try {
    seedrandomPkg = require('seedrandom');
    seedrandomAvailable = true;
    logger.info('seedrandom package found and will be used for RNG.');
  } catch (err) {
    seedrandomAvailable = false;
    logger.warn('MICROCHESS_USE_SEEDRANDOM=true but seedrandom is not installed; falling back to built-in PRNG.');
  }
}

// returns { rng: function, name: string, version?: string }
function createRngFromSeed(seedString) {
  if (seedrandomAvailable && seedrandomPkg) {
    // seedrandom returns a function that produces [0,1)
    const rngFn = seedrandomPkg(seedString);
    // try to get package version if available
    let ver = null;
    try { ver = require('seedrandom/package.json').version; } catch (e) { /* ignore */ }
    return { rng: rngFn, name: 'seedrandom', version: ver || null };
  }
  // fallback to mulberry32 derived from xfnv1a
  const seedInt = xfnv1a(seedString);
  return { rng: mulberry32(seedInt), name: 'mulberry32', version: null };
}

//
// Generate a single random chess game and return a structured entry
// Uses optional/seeded RNG when available.
//
function generateRandomChessGame(seedString) {
  // choose or create seed
  const providedSeed = typeof seedString === 'string' && seedString.length > 0;
  const seed = providedSeed ? seedString : crypto.randomBytes(8).toString('hex');
  const { rng, name: rng_name, version: rng_version } = createRngFromSeed(seed);

  const chess = new Chess();
  const moves = [];
  const startTime = new Date();
  let ply = 0;

  // limit total plies (half-moves)
  while (!chess.isGameOver() && ply < MAX_MOVES) {
    const legalMoves = chess.moves();
    if (!legalMoves || legalMoves.length === 0) break;
    const move = legalMoves[Math.floor(rng() * legalMoves.length)];
    chess.move(move);
    moves.push(move);
    ply++;
  }
  const endTime = new Date();

  // Build PGN moves (SAN style with move numbers)
  let pgnMoves = '';
  for (let i = 0; i < moves.length; i++) {
    if (i % 2 === 0) pgnMoves += `${Math.floor(i / 2) + 1}. `;
    pgnMoves += moves[i] + ' ';
  }
  pgnMoves = pgnMoves.trim();

  // Result and reason
  let result = '*', reason = '';
  try {
    if (chess.isCheckmate()) {
      // If checkmate, the side NOT to move delivered mate.
      result = chess.turn() === 'w' ? '0-1' : '1-0';
      reason = 'Checkmate';
    } else if (chess.isStalemate()) {
      result = '1/2-1/2';
      reason = 'Draw by stalemate';
    } else if (chess.isThreefoldRepetition && chess.isThreefoldRepetition()) {
      result = '1/2-1/2';
      reason = 'Draw by threefold repetition';
    } else if (chess.isInsufficientMaterial && chess.isInsufficientMaterial()) {
      result = '1/2-1/2';
      reason = 'Draw by insufficient material';
    } else if (chess.isDraw && chess.isDraw()) {
      result = '1/2-1/2';
      reason = 'Draw';
    }
  } catch (err) {
    // Some older/newer chess libs might not implement every helper; ignore safely.
    logger.debug(`Result detection encountered error: ${err && err.message ? err.message : err}`);
  }

  const pgnHeaders = [
    `[Event "Random Game"]`,
    `[Site "microchess"]`,
    `[Date "${startTime.toISOString().slice(0, 10).replace(/-/g, ".")}"]`,
    `[Result "${result}"]`,
    `[PlyCount "${moves.length}"]`
  ].join('\n');

  const pgn = `${pgnHeaders}\n\n${pgnMoves} ${result}`;

  return {
    process: 'microchess',
    message: `Random Game Of Chess: ${pgnMoves}`,
    status: 'generated',
    timestamp: endTime.toISOString(),
    move_count: moves.length,
    result,
    reason,
    final_fen: chess.fen(),
    pgn,
    // reproducibility metadata
    rng: rng_name,
    rng_version: rng_version || null,
    seed
  };
}

//
// Main runner: load, append, save
//
let running = false;

async function runOnce() {
  if (running) {
    logger.warn('Previous run not finished yet; skipping this interval.');
    return;
  }
  running = true;
  try {
    const existing = await loadLogs();
    // Use env-provided seed if present; otherwise generate one per run and save it
    const envSeed = process.env.MICROCHESS_SEED && process.env.MICROCHESS_SEED.length > 0 ? process.env.MICROCHESS_SEED : undefined;
    const entry = generateRandomChessGame(envSeed);
    existing.push(entry);
    await writeLogsWithRetries(existing);
    logger.info(`Random chess game generated and saved to ${OUTPUT_FILE} (seed=${entry.seed}, rng=${entry.rng})`);
  } catch (err) {
    logger.error(`Failed to complete run: ${err && err.message ? err.message : err}`);
  } finally {
    running = false;
  }
}

//
// Graceful shutdown to ensure last run finishes and file handles are clean.
//
let shutdownInitiated = false;
async function gracefulShutdown(signal) {
  if (shutdownInitiated) return;
  shutdownInitiated = true;
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  try {
    // attempt one final run to persist games if not already running
    if (!running) {
      await runOnce();
    } else {
      // wait up to a short timeout for current run to finish
      const deadline = Date.now() + 5000;
      while (running && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  } catch (err) {
    logger.warn(`Error during shutdown run: ${err && err.message ? err.message : err}`);
  } finally {
    logger.info('Shutdown complete.');
    process.exit(0);
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err && err.stack ? err.stack : err}`);
  gracefulShutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled promise rejection: ${reason && reason.stack ? reason.stack : reason}`);
});

//
// Startup: run once and then schedule according to GENERATOR_INTERVAL
//
(async function startup() {
  logger.info('microchess starting');
  try {
    await runOnce();
  } catch (err) {
    logger.error(`Initial run failed: ${err && err.message ? err.message : err}`);
  }

  if (!RUN_ONCE) {
    // use setInterval with async wrapper
    const timer = setInterval(() => {
      // fire & forget; internal locking prevents overlaps
      runOnce().catch((err) => logger.error(`Scheduled run failed: ${err && err.message ? err.message : err}`));
    }, GENERATOR_INTERVAL);

    // clear interval on exit signals to avoid dangling timers
    process.on('exit', () => clearInterval(timer));
  } else {
    logger.info('Running in RUN_ONCE mode; process will exit.');
    // give a short grace period for logs to flush then exit.
    setTimeout(() => process.exit(0), 500);
  }
})();
