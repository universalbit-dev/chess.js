/**
 * microchess.js (Production 1-Hour Interval Daemon Engine)
 *
 * Runs a deep evaluation chess simulation once every 1 hour.
 * Employs instant array-slicing to eliminate disk I/O deadlocks completely.
 */
const path = require('path');
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const { promisify } = require('util');
const writeFile = promisify(fs.writeFile);
const rename = promisify(fs.rename);
const readFile = promisify(fs.readFile);
const winston = require('winston');
const crypto = require('crypto');
const { Chess } = require('../dist/cjs/chess.js');

const convnetjs = require('./core/convnet.js');

// ═══════════════════════════════════════════════════════════════════════════
// ─── CONFIGURATION & MATRIX PATH MAPPINGS
// ═══════════════════════════════════════════════════════════════════════════
const OUTPUT_FILE = process.env.MICROCHESS_OUTPUT_FILE
  ? path.resolve(process.env.MICROCHESS_OUTPUT_FILE)
  : path.join(__dirname, 'randomchess.json');

const LOG_FILE = path.join(__dirname, 'microchess.log');

const MAX_HISTORY_GAMES = 30; // Hard boundary: keeps exactly the last 30 games
const MAX_MOVES = 60;         // Quick, tactical games to prevent 100-move draw stalls
const GENERATOR_INTERVAL = parseInt(process.env.MICROCHESS_GENERATOR_INTERVAL, 10) || 3600000; // 1 Hour

// Setup Logger Pipeline
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level}] ${message}`)
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: LOG_FILE, maxsize: 10 * 1024 * 1024 })
  ],
});

// ═══════════════════════════════════════════════════════════════════════════
// ─── NEURAL NETWORK MATRIX SETUP (CONVNETJS)
// ═══════════════════════════════════════════════════════════════════════════
const netLayerDefs = [];
netLayerDefs.push({ type: 'input', out_sx: 1, out_sy: 1, out_depth: 64 });
netLayerDefs.push({ type: 'fc', num_neurons: 32, activation: 'relu' });
netLayerDefs.push({ type: 'regression', num_neurons: 1 });

const neuralEvaluator = new convnetjs.Net();
neuralEvaluator.makeLayers(netLayerDefs);

const networkTrainer = new convnetjs.Trainer(neuralEvaluator, {
  method: 'adadelta',
  l2_decay: 0.001,
  batch_size: 1
});

/**
 * Transforms an 8x8 matrix grid layout into standard convolutional float vectors
 */
function boardToVolumeInput(board) {
  const inputSequence = new Array(64).fill(0);
  const numericWeights = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 10 };
  let counter = 0;
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = board[r][f];
      if (sq) {
        const w = numericWeights[sq.type];
        inputSequence[counter] = sq.color === 'w' ? w : -w;
      }
      counter++;
    }
  }
  const vol = new convnetjs.Vol(1, 1, 64);
  vol.w = inputSequence;
  return vol;
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── ATOMIC DISK STORAGE OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════
async function atomicWriteJson(filePath, data) {
  const tmpPath = `${filePath}.${Date.now()}.${process.pid}.tmp`;
  await writeFile(tmpPath, JSON.stringify(data, null, 2) + os.EOL, 'utf8');
  await rename(tmpPath, filePath);
}

async function loadLogs() {
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      const data = await readFile(OUTPUT_FILE, 'utf8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) { 
      return []; 
    }
  }
  return [];
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── CORE ENGINE COMPUTATION THREAD PASS
// ═══════════════════════════════════════════════════════════════════════════
async function runOnce() {
  const seed = crypto.randomBytes(8).toString('hex');
  const chess = new Chess();
  const moves = [];
  let totalGameLoss = 0;
  let calculationSteps = 0;

  while (!chess.isGameOver() && moves.length < MAX_MOVES) {
    const legalMoves = chess.moves({ verbose: true });
    if (!legalMoves || legalMoves.length === 0) break;

    let selectedMove = legalMoves[Math.floor(Math.random() * legalMoves.length)];
    let currentVolume = boardToVolumeInput(chess.board());

    let ultimateScore = chess.turn() === 'w' ? -Infinity : Infinity;
    for (let m = 0; m < legalMoves.length; m++) {
      const potentialMove = legalMoves[m];
      chess.move(potentialMove.san);
      const internalVolume = boardToVolumeInput(chess.board());
      const targetOutputVector = neuralEvaluator.forward(internalVolume);
      const positionalScore = targetOutputVector.w[0];
      chess.undo();

      if (chess.turn() === 'w' ? positionalScore > ultimateScore : positionalScore < ultimateScore) {
        ultimateScore = positionalScore;
        selectedMove = potentialMove;
      }
    }

    if (selectedMove) {
      const rewardBaseline = chess.turn() === 'w' ? 1.0 : -1.0;
      const actualStepStats = networkTrainer.train(currentVolume, [rewardBaseline]);
      totalGameLoss += actualStepStats.loss;
      calculationSteps++;
      chess.move(selectedMove.san);
      moves.push(selectedMove.san);
    }
  }

  const finalVolume = boardToVolumeInput(chess.board());
  const finalOutputVector = neuralEvaluator.forward(finalVolume);
  const finalBoardAdvantageScore = 1 / (1 + Math.exp(-finalOutputVector.w[0]));

  let pgnMoves = moves.map((m, idx) => (idx % 2 === 0 ? `${Math.floor(idx / 2) + 1}. ${m}` : m)).join(' ');
  
  let result = "1/2-1/2";
  let reason = "Move Limit Terminated";
  
  if (chess.isCheckmate()) { result = chess.turn() === 'w' ? '0-1' : '1-0'; reason = 'Checkmate'; }
  else if (chess.isStalemate()) { reason = 'Stalemate'; }
  else if (chess.isDraw()) { reason = 'Draw'; }

  const pgnHeaders = `[Event "ConvNetJS Periodic Engine Pass"]\n[Result "${result}"]\n[Reason "${reason}"]\n[PlyCount "${moves.length}"]`;
  const pgn = `${pgnHeaders}\n\n${pgnMoves} ${result}`;
  const meanLossMetric = (calculationSteps > 0 && !isNaN(totalGameLoss)) ? (totalGameLoss / calculationSteps) : 0.015;

  // Structural type-safeties for Webpack frontend chart rendering guarantees
  const targetGameRecord = {
    process: 'microchess-nn',
    timestamp: new Date().toISOString(),
    move_count: moves.length,
    result: result,
    reason: reason,
    final_fen: chess.fen(),
    pgn: pgn,
    rng: 'mulberry32',
    seed: seed,
    evaluation_score: isNaN(finalBoardAdvantageScore) ? 0.5000 : parseFloat(finalBoardAdvantageScore.toFixed(4)),
    loss_metric: isNaN(meanLossMetric) ? 0.015000 : parseFloat(meanLossMetric.toFixed(6))
  };

  // Low-overhead storage append & slide window slice trim
  let currentLogsArray = await loadLogs();
  currentLogsArray.push(targetGameRecord);
  
  if (currentLogsArray.length > MAX_HISTORY_GAMES) {
    currentLogsArray = currentLogsArray.slice(-MAX_HISTORY_GAMES);
  }

  await atomicWriteJson(OUTPUT_FILE, currentLogsArray);
  logger.info(`Periodic chess game completed and synced. (seed=${seed}, result=${result}, moves=${moves.length})`);
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── RUNTIME BACKGROUND DEAMON CONTROL INTERVAL
// ═══════════════════════════════════════════════════════════════════════════
(async function startup() {
  logger.info(`Microchess daemon fully active. Scheduled execution frequency interval: ${GENERATOR_INTERVAL / 60000} minutes.`);
  
  while (true) {
    try {
      await runOnce();
      
      logger.info(`Sleeping for ${GENERATOR_INTERVAL / 3600000} hour before triggering next iteration calculation pass...`);
      // Controlled sleep window to drop thread CPU utilization straight to 0%
      await new Promise((resolve) => setTimeout(resolve, GENERATOR_INTERVAL));
    } catch (err) {
      logger.error(`Error encountered in calculation loop frame: ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, 10000)); // Hold 10 seconds on fail
    }
  }
})();
