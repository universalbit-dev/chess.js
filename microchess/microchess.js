require('dotenv').config();
const fs = require('fs');
const path = require('path');
const winston = require('winston');
const { Chess } = require('../dist/cjs/chess.js');

const OUTPUT_FILE = path.join(__dirname, 'randomchess.json');
const MAX_SIZE_BYTES = 1 * 1024 * 1024; // 1MB
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
  while (!chess.isGameOver() && moveNumber <= 100) {
    const legalMoves = chess.moves();
    if (legalMoves.length === 0) break;
    const move = legalMoves[Math.floor(Math.random() * legalMoves.length)];
    chess.move(move);
    moves.push(move);
    moveNumber++;
  }
  // Create a PGN-like string
  let pgnMoves = '';
  for (let i = 0; i < moves.length; i++) {
    if (i % 2 === 0) pgnMoves += `${Math.floor(i / 2) + 1}. `;
    pgnMoves += moves[i] + ' ';
  }
  pgnMoves = pgnMoves.trim();
  return {
    process: 'microchess',
    message: `Random Game Of Chess: ${pgnMoves}`,
    status: 'generated',
    timestamp: new Date().toISOString()
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
setInterval(runOnce, INTERVAL);

logger.info(`microchess.js started. Generating a random game every ${INTERVAL / 1000} seconds.`);
