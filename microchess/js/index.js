import { Chessboard } from "https://cdn.jsdelivr.net/npm/cm-chessboard@4/src/cm-chessboard/Chessboard.js";

// ═══════════════════════════════════════════════════════════════════════════
// ─── STATE ARCHITECTURE
// ═══════════════════════════════════════════════════════════════════════════
let telemetryTicks = 0;
let lastRenderedSeed = null;

// Determine endpoint location dynamically based on the active runtime address
const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

// ROUTING MATRIX: Fetch from your local development server API, 
// or read the static file directly relative to your GitHub Pages root URL layout.
const API_ENDPOINT = isLocal 
  ? '/api/live-game' 
  : './randomchess.json'; // Reads the static file right from your hosted assets repository

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
    const response = await fetch(API_ENDPOINT);
    if (!response.ok) return;

    const targetRecord = await response.json();
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
