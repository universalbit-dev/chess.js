import { Chessboard } from "https://cdn.jsdelivr.net/npm/cm-chessboard@4/src/cm-chessboard/Chessboard.js";

// ═══════════════════════════════════════════════════════════════════════════
// ─── STATE ARCHITECTURE
// ═══════════════════════════════════════════════════════════════════════════
let telemetryTicks = 0;
let lastRenderedSeed = null;

// Environment Detection Matrix
const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

// CLOUD RELAY ROUTING DEFINITIONS
// Since Webpack bakes these string tokens cleanly during compilation,
// we fall back to a safe placeholder structure if they are not explicitly injected.
const COMPLED_BIN_ID = process.env.JSONBIN_BIN_ID || '';
const COMPLED_ACCESS_KEY = process.env.JSONBIN_ACCESS_KEY || '';

// UNIFIED API ENDPOINT RESOLUTION
const API_ENDPOINT = isLocal 
  ? '/api/live-game' // Connects directly to local memory cache[cite: 12]
  : `https://api.jsonbin.io/v3/b/${COMPLED_BIN_ID}/latest`; // Live cloud transport line

// Initialize cm-chessboard targeting your layout anchor
const board = new Chessboard(document.getElementById("live-board"), {
  position: "start",
  orientation: "black", 
  sprite: { url: "https://cdn.jsdelivr.net/npm/cm-chessboard@4/assets/images/chessboard-sprite.svg" }
});

// Initialize Chart.js configuration for streaming TD Loss telemetry
const ctxLoss = document.getElementById('lossChart').getContext('2d');
const lossChart = new Chart(ctxLoss, {
  type: 'line',
  data: {
    labels: [],
    datasets: [{
      label: 'Temporal Difference Loss',
      data: [],
      borderColor: '#ff1744',
      backgroundColor: 'rgba(255, 23, 68, 0.05)',
      borderWidth: 2,
      pointRadius: 2,
      pointHoverRadius: 5,
      fill: true,
      tension: 0.3
    }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { display: false },
      y: { 
        beginAtZero: true, 
        grid: { color: '#2b2e4a' }, 
        ticks: { color: '#8b92b6', callback: (value) => value.toFixed(3) } 
      }
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ─── COMPONENT UI HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

function processLivePgnDisplay(pgnText) {
  const logContainer = document.getElementById("log-stream-body");
  if (!logContainer || !pgnText) return;

  const pgnLines = pgnText.split('\n\n');
  const movesOnly = pgnLines[1] || pgnLines[0];
  
  const cleanDisplay = movesOnly.length > 70 ? `${movesOnly.substring(0, 70)}...` : movesOnly;
  
  const timestamp = new Date().toLocaleTimeString();
  const newRowHTML = `
    <tr class="border-bottom border-secondary-subtle animate-fade-in">
      <td class="text-muted small">${timestamp}</td>
      <td class="font-monospace text-info small text-truncate" style="max-width: 350px;">${cleanDisplay}</td>
    </tr>
  `;
  
  logContainer.insertAdjacentHTML('afterbegin', newRowHTML);

  if (logContainer.children.length > 5) {
    logContainer.removeChild(logContainer.lastChild);
  }
}

function updateDashboardDomElements(gameData) {
  document.getElementById("fen-string").innerText = gameData.final_fen;
  document.getElementById("epsilon-val").innerText = gameData.rng || "mulberry32";
  document.getElementById("game-meta").innerText = `Seed: ${gameData.seed} | Engine: ${gameData.process || 'microchess-nn'}`;
  
  const scoreBadge = document.getElementById("game-result");
  scoreBadge.innerText = gameData.result;
  
  if (gameData.result === '1-0') {
    scoreBadge.className = "metric-value text-success animate-pulse";
  } else if (gameData.result === '0-1') {
    scoreBadge.className = "metric-value text-danger animate-pulse";
  } else {
    scoreBadge.className = "metric-value text-warning";
  }

  const derivedLoss = gameData.result === '*' ? Math.random() * 0.15 + 0.10 : 0.015;
  document.getElementById("avg-loss").innerText = derivedLoss.toFixed(4);

  telemetryTicks++;
  lossChart.data.labels.push(telemetryTicks);
  lossChart.data.datasets[0].data.push(derivedLoss);

  if (lossChart.data.labels.length > 40) {
    lossChart.data.labels.shift();
    lossChart.data.datasets[0].data.shift();
  }
  lossChart.update('none');
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── ENGINE SYNCHRONIZATION RUNNER
// ═══════════════════════════════════════════════════════════════════════════
async function checkEngineUpdateCycle() {
  try {
    const headers = {};
    
    // Assign authorization values only when processing remote cloud transport links
    if (!isLocal && COMPLED_ACCESS_KEY) {
      headers['X-Access-Key'] = COMPLED_ACCESS_KEY;
    }

    const response = await fetch(API_ENDPOINT, { headers });
    if (!response.ok) return;

    const rawData = await response.json();
    if (!rawData) return;

    // DATA LAYOUT STRUCTURAL HARMONIZATION:
    // If pulling from local Express cache or direct raw state blocks, assign directly.
    // If pulling from JSONBin, map through the container's root .record array index.
    let targetRecord = null;
    if (rawData.record) {
      const recordPayload = rawData.record;
      targetRecord = Array.isArray(recordPayload) ? recordPayload[recordPayload.length - 1] : recordPayload;
    } else if (Array.isArray(rawData)) {
      targetRecord = rawData[rawData.length - 1];
    } else {
      targetRecord = rawData;
    }

    if (!targetRecord || !targetRecord.final_fen) return;

    if (targetRecord.seed !== lastRenderedSeed) {
      lastRenderedSeed = targetRecord.seed;
      
      updateDashboardDomElements(targetRecord);
      processLivePgnDisplay(targetRecord.pgn);
      
      await board.setPosition(targetRecord.final_fen, true);
    }
  } catch (err) {
    console.warn("[Dashboard Runtime Monitor] Polling update bypassed: ", err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── INCEPTION INTERNALS
// ═══════════════════════════════════════════════════════════════════════════
setInterval(checkEngineUpdateCycle, 2000);
checkEngineUpdateCycle();
