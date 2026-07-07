/**
 * microchess.js (Persistent Background Engine Daemon Loop)
 *
 * Runs continuous neural network chess simulations back-to-back.
 * Built to work cleanly with interactive frontend control dashboards.
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

//
// System Path Mapping Configurations
//
const OUTPUT_FILE = process.env.MICROCHESS_OUTPUT_FILE
  ? path.resolve(process.env.MICROCHESS_OUTPUT_FILE)
  : path.join(__dirname, 'randomchess.json');

const LOG_FILE = path.join(__dirname, 'microchess.log');
const MAX_SIZE_BYTES = 1 * 1024 * 1024; // 1MB Max Array File Size Safeguard
const MAX_MOVES = 100;

//
// Winston Pipeline Logger
//
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

//
// Global Control Flags for State Deck Tracking
//
let isPaused = false; 

// Initialize ConvNetJS Network Layer Matrix
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
 * Transforms an 8x8 matrix into optimized convolutional float vectors
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

async function atomicWriteJson(filePath, data) {
  const tmpPath = `${filePath}.${Date.now()}.${process.pid}.tmp`;
  await writeFile(tmpPath, JSON.stringify(data, null, 2) + os.EOL, 'utf8');
  await rename(tmpPath, filePath);
}

async function loadLogs() {
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      const data = await readFile(OUTPUT_FILE, 'utf8');
      return JSON.parse(data) || [];
    } catch (e) { return []; }
  }
  return [];
}

/**
 * Executes a single complete game sequence iteration pass
 */
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
  let result = chess.isCheckmate() ? (chess.turn() === 'w' ? '0-1' : '1-0') : '1/2-1/2';

  const targetGameRecord = {
    process: 'microchess-nn',
    timestamp: new Date().toISOString(),
    move_count: moves.length,
    result,
    final_fen: chess.fen(),
    pgn: `[Result "${result}"]\n\n${pgnMoves}`,
    seed,
    evaluation_score: parseFloat(finalBoardAdvantageScore.toFixed(4)),
    loss_metric: parseFloat((calculationSteps > 0 ? totalGameLoss / calculationSteps : 0.015).toFixed(6))
  };

  const currentLogsArray = await loadLogs();
  currentLogsArray.push(targetGameRecord);
  
  // Keep array within size limits
  while (Buffer.byteLength(JSON.stringify(currentLogsArray), 'utf8') > MAX_SIZE_BYTES && currentLogsArray.length > 0) {
    currentLogsArray.shift();
  }

  await atomicWriteJson(OUTPUT_FILE, currentLogsArray);
  logger.info(`Neural chess game completed and updated database. (seed=${seed}, result=${result}, moves=${moves.length})`);
}

//
// SYSTEM INCEPTION (INFINITE PERSISTENT GENERATOR DAEMON LOOP)
//
(async function startup() {
  logger.info('Continuous infinite processing loop initialized.');
  
  while (true) {
    try {
      // ═══ THE CONTROLS ENGINE GUARD LAYER ═══
      if (isPaused) {
        // Sleep for 2 seconds without performing calculations if pause is toggled
        await new Promise((res) => setTimeout(res, 2000));
        continue;
      }

      await runOnce();
      
      // Post-game loop breathing room pass
      await new Promise((res) => setTimeout(res, 2000));
    } catch (err) {
      logger.error(`Loop pass encountered error: ${err.message}`);
      await new Promise((res) => setTimeout(res, 5000));
    }
  }
})();
