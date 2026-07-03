/**
 * microchess.js (Enhanced with ConvNetJS Inference Layer)
 *
 * Generates periodic neural-evaluation influenced or randomized chess games
 * and appends them to a JSON file.
 */
const path = require('path');
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const { promisify } = require('util');
const writeFile = promisify(fs.writeFile);
const rename = promisify(fs.rename);
const stat = promisify(fs.stat);
const readFile = promisify(fs.readFile);
const winston = require('winston');
const crypto = require('crypto');
const { Chess } = require('../dist/cjs/chess.js');

// Import Core Machine Learning Libraries
const convnetjs = require('./core/convnet.js');
const { DQNAgent } = require('./core/rl.js');

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

// Initialize Deep Evaluator Network (64 inputs -> 32 hidden units -> 1 output score)
const netLayerDefs = [];
netLayerDefs.push({ type: 'input', out_sx: 1, out_sy: 1, out_depth: 64 });
netLayerDefs.push({ type: 'fc', num_neurons: 32, activation: 'relu' });
netLayerDefs.push({ type: 'regression', num_neurons: 1 });

const neuralEvaluator = new convnetjs.Net();
neuralEvaluator.makeLayers(netLayerDefs);

/**
 * Transforms an 8x8 chess board layer map into an optimized Vol instance
 * mapping white values to positive scores and black to negative scores.
 */
function boardToVolumeInput(board) {
  const inputSequence = new Array(64).fill(0);
  const numericWeights = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 10 };

  let counter = 0;
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const square = board[rank][file];
      if (square) {
        const structuralWeight = numericWeights[square.type];
        inputSequence[counter] = square.color === 'w' ? structuralWeight : -structuralWeight;
      }
      counter++;
    }
  }

  const volInput = new convnetjs.Vol(1, 1, 64);
  volInput.w = inputSequence;
  return volInput;
}

//
// Atomic Write and Logs Management Utilities
//
async function atomicWriteJson(filePath, data) {
  const tmpPath = `${filePath}.${Date.now()}.${process.pid}.tmp`;
  const json = JSON.stringify(data, null, 2) + os.EOL;
  await writeFile(tmpPath, json, { encoding: 'utf8' });
  await rename(tmpPath, filePath);
}

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

function trimLogsToFitSize(logs) {
  try {
    let json = JSON.stringify(logs, null, 2);
    while (Buffer.byteLength(json, 'utf8') > MAX_SIZE_BYTES && logs.length > 0) {
      logs.shift();
      json = JSON.stringify(logs, null, 2);
    }
  } catch (err) {
    logger.error(`Error while trimming logs: ${err && err.message ? err.message : err}`);
  }
  return logs;
}

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
      await new Promise((res) => setTimeout(res, 100 * attempt));
    }
  }
}

//
// Reproducible RNG Support Components
//
function xfnv1a(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

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

function createRngFromSeed(seedString) {
  if (seedrandomAvailable && seedrandomPkg) {
    const rngFn = seedrandomPkg(seedString);
    let ver = null;
    try { ver = require('seedrandom/package.json').version; } catch (e) { /* ignore */ }
    return { rng: rngFn, name: 'seedrandom', version: ver || null };
  }
  const seedInt = xfnv1a(seedString);
  return { rng: mulberry32(seedInt), name: 'mulberry32', version: null };
}

//
// Core Game Logic enhanced with Deep Neural Evaluation Pass
//
function generateRandomChessGame(seedString) {
  const providedSeed = typeof seedString === 'string' && seedString.length > 0;
  const seed = providedSeed ? seedString : crypto.randomBytes(8).toString('hex');
  const { rng, name: rng_name, version: rng_version } = createRngFromSeed(seed);

  const chess = new Chess();
  const moves = [];
  const startTime = new Date();
  let ply = 0;

  // 30% exploration strategy variation modifier across steps
  const explorationThreshold = 0.30;

  while (!chess.isGameOver() && ply < MAX_MOVES) {
    const legalMoves = chess.moves({ verbose: true });
    if (!legalMoves || legalMoves.length === 0) break;

    let selectedMove = null;

    if (rng() < explorationThreshold) {
      // Epsilon-style exploration step: select clean random legal choice
      const targetIndex = Math.floor(rng() * legalMoves.length);
      selectedMove = legalMoves[targetIndex];
    } else {
      // Exploitation Mode step: Forward evaluations via neural pipeline
      let ultimateScore = chess.turn() === 'w' ? -Infinity : Infinity;

      for (let m = 0; m < legalMoves.length; m++) {
        const potentialMove = legalMoves[m];
        chess.move(potentialMove.san);

        const internalVolume = boardToVolumeInput(chess.board());
        // Run look-ahead state tracking forward pass optimized with bitwise casting internally
        const targetOutputVector = neuralEvaluator.forward(internalVolume);
        const positionalScore = targetOutputVector.w[0];

        chess.undo();

        if (chess.turn() === 'w') {
          if (positionalScore > ultimateScore) {
            ultimateScore = positionalScore;
            selectedMove = potentialMove;
          }
        } else {
          if (positionalScore < ultimateScore) {
            ultimateScore = positionalScore;
            selectedMove = potentialMove;
          }
        }
      }
    }

    // Safeguard fallback verification
    if (!selectedMove) {
      selectedMove = legalMoves[Math.floor(rng() * legalMoves.length)];
    }

    chess.move(selectedMove.san);
    moves.push(selectedMove.san);
    ply++;
  }
  const endTime = new Date();

  // Build PGN strings (SAN layout with indexes appended)
  let pgnMoves = '';
  for (let i = 0; i < moves.length; i++) {
    if (i % 2 === 0) pgnMoves += `${Math.floor(i / 2) + 1}. `;
    pgnMoves += moves[i] + ' ';
  }
  pgnMoves = pgnMoves.trim();

  let result = '*', reason = '';
  try {
    if (chess.isCheckmate()) {
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
    logger.debug(`Result detection encountered error: ${err && err.message ? err.message : err}`);
  }

  const pgnHeaders = [
    `[Event "Neural Influenced Random Game"]`,
    `[Site "microchess"]`,
    `[Date "${startTime.toISOString().slice(0, 10).replace(/-/g, ".")}"]`,
    `[Result "${result}"]`,
    `[PlyCount "${moves.length}"]`
  ].join('\n');

  const pgn = `${pgnHeaders}\n\n${pgnMoves} ${result}`;

  return {
    process: 'microchess-nn',
    message: `Neural Game Of Chess: ${pgnMoves}`,
    status: 'generated',
    timestamp: endTime.toISOString(),
    move_count: moves.length,
    result,
    reason,
    final_fen: chess.fen(),
    pgn,
    rng: rng_name,
    rng_version: rng_version || null,
    seed
  };
}

//
// Execution Loops and System Runners
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
    const envSeed = process.env.MICROCHESS_SEED && process.env.MICROCHESS_SEED.length > 0 ? process.env.MICROCHESS_SEED : undefined;
    const entry = generateRandomChessGame(envSeed);
    existing.push(entry);
    await writeLogsWithRetries(existing);
    logger.info(`Neural chess game completed and updated to ${OUTPUT_FILE} (seed=${entry.seed}, evaluationEngine=convnetjs)`);
  } catch (err) {
    logger.error(`Failed to complete run: ${err && err.message ? err.message : err}`);
  } finally {
    running = false;
  }
}

let shutdownInitiated = false;
async function gracefulShutdown(signal) {
  if (shutdownInitiated) return;
  shutdownInitiated = true;
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  try {
    if (!running) {
      await runOnce();
    } else {
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

(async function startup() {
  logger.info('microchess starting with ConvNetJS integration layer');
  try {
    await runOnce();
  } catch (err) {
    logger.error(`Initial run failed: ${err && err.message ? err.message : err}`);
  }

  if (!RUN_ONCE) {
    const timer = setInterval(() => {
      runOnce().catch((err) => logger.error(`Scheduled run failed: ${err && err.message ? err.message : err}`));
    }, GENERATOR_INTERVAL);

    process.on('exit', () => clearInterval(timer));
  } else {
    logger.info('Running in RUN_ONCE mode; process will exit.');
    setTimeout(() => process.exit(0), 500);
  }
})();
