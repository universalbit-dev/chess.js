const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const fs = require('fs');
const winston = require('winston');
const { Chess } = require('../dist/cjs/chess.js');

const OUTPUT_FILE = path.join(__dirname, 'randomchess.json');

// Maximum allowed file size for output (default: 1MB).
// To customize, change the value below (in bytes), e.g. 2 * 1024 * 1024 for 2MB.
const MAX_SIZE_BYTES = 1 * 1024 * 1024;

/*
| MICROCHESS_GENERATOR_INTERVAL (ms) | Interval         | Example use           |
|------------------------------------|------------------|-----------------------|
|        60000                       | 1 minute         | Fast testing          |
|      3600000                       | 1 hour (default) | Normal production     |
|    86400000                        | 24 hours         | Daily generation      |

Set in .env to control chess game generation frequency, e.g.:
MICROCHESS_GENERATOR_INTERVAL=3600000  // every hour
*/

const GENERATOR_INTERVAL = parseInt(process.env.MICROCHESS_GENERATOR_INTERVAL, 10) || 3600000;

// Winston logger setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level}] ${message}`)
  ),
  transports: [new winston.transports.Console()]
});

function loadLogs() {
  try {
    if (fs.existsSync(OUTPUT_FILE)) {
      const data = fs.readFileSync(OUTPUT_FILE, 'utf8');
      const logs = JSON.parse(data);
      return Array.isArray(logs) ? logs : [];
    }
  } catch {
    logger.warn('Failed to load logs, starting fresh.');
  }
  return [];
}

function trimLogsToFitSize(logs) {
  let json = JSON.stringify(logs, null, 2);
  while (Buffer.byteLength(json, 'utf8') > MAX_SIZE_BYTES && logs.length > 0) {
    logs.shift();
    json = JSON.stringify(logs, null, 2);
  }
  return logs;
}

function writeLogs(logs) {
  logs = trimLogsToFitSize(logs);
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(logs, null, 2));
}

function generateRandomChessGame() {
  const chess = new Chess();
  let moves = [];
  let moveNumber = 1;
  const startTime = new Date();
  while (!chess.isGameOver() && moveNumber <= 100) {
    const legalMoves = chess.moves();
    if (legalMoves.length === 0) break;
    const move = legalMoves[Math.floor(Math.random() * legalMoves.length)];
    chess.move(move);
    moves.push(move);
    moveNumber++;
  }
  const endTime = new Date();
  // PGN moves
  let pgnMoves = '';
  for (let i = 0; i < moves.length; i++) {
    if (i % 2 === 0) pgnMoves += `${Math.floor(i / 2) + 1}. `;
    pgnMoves += moves[i] + ' ';
  }
  pgnMoves = pgnMoves.trim();

  // Determine result and reason
  let result = '*', reason = '';
  if (chess.isCheckmate()) {
    result = chess.turn() === 'w' ? '0-1' : '1-0';
    reason = 'Checkmate';
  } else if (chess.isStalemate()) {
    result = '1/2-1/2';
    reason = 'Draw by stalemate';
  } else if (chess.isThreefoldRepetition()) {
    result = '1/2-1/2';
    reason = 'Draw by threefold repetition';
  } else if (chess.isInsufficientMaterial()) {
    result = '1/2-1/2';
    reason = 'Draw by insufficient material';
  } else if (chess.isDraw()) {
    result = '1/2-1/2';
    reason = 'Draw';
  }

  // Build PGN with headers
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
    pgn
  };
}

function runOnce() {
  let logs = loadLogs();
  const newEntry = generateRandomChessGame();
  logs.push(newEntry);
  writeLogs(logs);
  logger.info('Random chess game generated and saved to randomchess.json');
}

// Run once at startup
runOnce();

// Then schedule continuous runs
setInterval(runOnce, GENERATOR_INTERVAL);
