/**
 * replay.js
 *
 * Replays a randomchess.json entry (or any seed) to verify reproducibility.
 *
 * Usage:
 *   node replay.js               # lists last 5 entries in randomchess.json
 *   node replay.js --seed <seed> # replay using provided seed (prints PGN/FEN)
 *   node replay.js --index <n>   # replay entry at index n (0-based) from randomchess.json
 *   node replay.js --file <path> # specify an alternate JSON file
 *
 * Notes:
 *  - This uses the same lightweight PRNG (mulberry32) as microchess.js by default.
 *  - If MICROCHESS_USE_SEEDRANDOM=true and you have seedrandom installed, it will be used.
 *  - The script attempts to reproduce the moves and compares PGN / final FEN against the stored entry when available.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Chess } = require('../dist/cjs/chess.js');

// Configuration (can mirror the env settings used by microchess.js)
const DEFAULT_OUTPUT = path.join(__dirname, 'randomchess.json');
const MAX_MOVES = parseInt(process.env.MICROCHESS_MAX_MOVES, 10) || 100;

let seedrandomPkg = null;
let seedrandomAvailable = false;
if ((process.env.MICROCHESS_USE_SEEDRANDOM || '').toLowerCase() === 'true') {
  try {
    seedrandomPkg = require('seedrandom');
    seedrandomAvailable = true;
    console.info('seedrandom found and will be used for RNG.');
  } catch (e) {
    console.warn('MICROCHESS_USE_SEEDRANDOM=true but seedrandom is not installed. Falling back to mulberry32.');
  }
}

// xfnv1a string -> 32-bit integer
function xfnv1a(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32 PRNG -> returns function() in [0,1)
function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function createRngFromSeed(seedString) {
  if (seedrandomAvailable && seedrandomPkg) {
    return { rng: seedrandomPkg(seedString), name: 'seedrandom' };
  }
  const seedInt = xfnv1a(seedString);
  return { rng: mulberry32(seedInt), name: 'mulberry32' };
}

function buildPgnFromMoves(moves) {
  let pgnMoves = '';
  for (let i = 0; i < moves.length; i++) {
    if (i % 2 === 0) pgnMoves += `${Math.floor(i / 2) + 1}. `;
    pgnMoves += moves[i] + ' ';
  }
  return pgnMoves.trim();
}

async function readJsonFile(filePath) {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to read/parse ${filePath}: ${err && err.message ? err.message : err}`);
  }
}

function simulateGameWithSeed(seed, maxPlies) {
  const { rng, name } = createRngFromSeed(seed);
  const chess = new Chess();
  const moves = [];
  let ply = 0;
  while (!chess.isGameOver() && ply < maxPlies) {
    const legalMoves = chess.moves();
    if (!legalMoves || legalMoves.length === 0) break;
    const move = legalMoves[Math.floor(rng() * legalMoves.length)];
    chess.move(move);
    moves.push(move);
    ply++;
  }
  const pgnMoves = buildPgnFromMoves(moves);
  return {
    rng: name,
    seed,
    moves,
    pgnMoves,
    final_fen: chess.fen(),
    move_count: moves.length
  };
}

function printComparison(stored, simulated) {
  console.log('--- stored entry ---');
  console.log(`seed: ${stored.seed}`);
  console.log(`rng:  ${stored.rng}${stored.rng_version ? `@${stored.rng_version}` : ''}`);
  console.log(`move_count: ${stored.move_count}`);
  console.log(`final_fen: ${stored.final_fen}`);
  console.log(`pgn: ${stored.pgn}`);
  console.log('');
  console.log('--- simulated run ---');
  console.log(`seed: ${simulated.seed}`);
  console.log(`rng:  ${simulated.rng}`);
  console.log(`move_count: ${simulated.move_count}`);
  console.log(`final_fen: ${simulated.final_fen}`);
  console.log(`pgn moves: ${simulated.pgnMoves}`);
  console.log('');
  const pgnMatch = (stored.pgn || '').trim() === (`${stored.pgn ? stored.pgn.split('\n\n')[0] : ''}\n\n${simulated.pgnMoves} ${stored.result || ''}`.trim());
  const fenMatch = (stored.final_fen || '') === simulated.final_fen;
  console.log(`PGN match: ${pgnMatch ? 'YES' : 'NO'}`);
  console.log(`FEN match: ${fenMatch ? 'YES' : 'NO'}`);
  if (!pgnMatch || !fenMatch) {
    console.warn('Reproduction mismatch — ensure you are using the same microchess.js version, RNG implementation, and library versions.');
  } else {
    console.log('Reproduction successful.');
  }
}

function usageAndExit(code = 0) {
  console.log('Usage: node replay.js [--seed <seed>] [--index <n>] [--file <path>]');
  process.exit(code);
}

(async function main() {
  const argv = process.argv.slice(2);
  let seedArg = null;
  let indexArg = null;
  let fileArg = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seed' && argv[i + 1]) { seedArg = argv[i + 1]; i++; }
    else if (a === '--index' && argv[i + 1]) { indexArg = parseInt(argv[i + 1], 10); i++; }
    else if (a === '--file' && argv[i + 1]) { fileArg = argv[i + 1]; i++; }
    else if (a === '--help' || a === '-h') { usageAndExit(0); }
    else { usageAndExit(1); }
  }

  const BASE_DIR = path.resolve(__dirname);
  const filePath = fileArg ? path.resolve(fileArg) : DEFAULT_OUTPUT;

   // Path Traversal Mitigation
  if (!filePath.startsWith(BASE_DIR + path.sep)) {
  console.error('Access to paths outside the allowed directory is forbidden.');
  process.exit(1);
  }
  
  // If no args, list last few entries
  if (!seedArg && indexArg == null) {
    try {
      const arr = await readJsonFile(filePath);
      if (!Array.isArray(arr)) {
        console.error(`${filePath} does not contain a top-level array.`);
        process.exit(2);
      }
      const sample = arr.slice(-5).reverse();
      console.log(`Last ${sample.length} entries from ${filePath}:`);
      sample.forEach((e, idx) => {
        console.log(`${idx}: seed=${e.seed} moves=${e.move_count} result=${e.result} ts=${e.timestamp}`);
      });
      console.log('');
      console.log('To replay an entry: node replay.js --index <n> (n is 0.. for the list above, 0 = most recent)');
      console.log('To replay by seed: node replay.js --seed <seed>');
      process.exit(0);
    } catch (err) {
      console.error(err.message);
      process.exit(2);
    }
  }

  let storedEntry = null;
  let targetSeed = seedArg;

  if (indexArg != null) {
    try {
      const arr = await readJsonFile(filePath);
      if (!Array.isArray(arr)) throw new Error('file does not contain an array');
      const entry = arr[arr.length - 1 - indexArg]; // index 0 -> most recent
      if (!entry) {
        console.error(`No entry at index ${indexArg} (file has ${arr.length} entries).`);
        process.exit(3);
      }
      storedEntry = entry;
      targetSeed = storedEntry.seed;
    } catch (err) {
      console.error(`Failed to read entry by index: ${err.message}`);
      process.exit(3);
    }
  }

  if (!targetSeed) {
    console.error('No seed provided and no stored entry selected.');
    usageAndExit(1);
  }

  // Use stored move_count if available to bound simulation so we follow same number of plies
  const maxPlies = (storedEntry && typeof storedEntry.move_count === 'number') ? storedEntry.move_count : MAX_MOVES;

  const simulated = simulateGameWithSeed(targetSeed, maxPlies);

  if (storedEntry) {
    printComparison(storedEntry, simulated);
  } else {
    console.log('Simulated run (no stored entry was provided):');
    console.log(`seed: ${simulated.seed}`);
    console.log(`rng:  ${simulated.rng}`);
    console.log(`move_count: ${simulated.move_count}`);
    console.log(`final_fen: ${simulated.final_fen}`);
    console.log(`pgn moves: ${simulated.pgnMoves}`);
  }
})();
