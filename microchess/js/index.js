import { Chessboard } from "https://cdn.jsdelivr.net/npm/cm-chessboard@4/src/cm-chessboard/Chessboard.js";

// ═══════════════════════════════════════════════════════════════════════════
// ─── STATE ARCHITECTURE & INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════
let telemetryTicks = 0;
let lastRenderedSeed = null;
let lossChart = null;
let isStreamTrackingActive = true; // Governs whether the browser maps incoming data

// Initialize cm-chessboard targeting your layout anchor
const board = new Chessboard(document.getElementById("live-board"), {
  position: "start",
  orientation: "black", 
  sprite: { url: "https://cdn.jsdelivr.net/npm/cm-chessboard@4/assets/images/chessboard-sprite.svg" }
});

// Initialize Chart.js configuration for Dual-Axis Telemetry (Win % + Loss)
const ctxLoss = document.getElementById('lossChart').getContext('2d');
lossChart = new Chart(ctxLoss, {
  type: 'line',
  data: {
    labels: [],
    datasets: [
      {
        label: 'Positional Advantage (Win %)',
        data: [],
        borderColor: '#00b0ff',
        backgroundColor: 'rgba(0, 176, 255, 0.04)',
        yAxisID: 'yWin',
        borderWidth: 2.5,
        pointRadius: 1,
        tension: 0.25,
        fill: true
      },
      {
        label: 'TD Learning Delta Loss',
        data: [],
        borderColor: '#ff1744',
        backgroundColor: 'transparent',
        yAxisID: 'yLoss',
        borderWidth: 1.5,
        borderDash: [3, 3], // Dotted tracking curve layout
        pointRadius: 0,
        tension: 0.35,
        fill: false
      }
    ]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        labels: { color: '#8b92b6', font: { size: 9, family: 'monospace' } }
      }
    },
    scales: {
      x: { display: false },
      yWin: {
        type: 'linear',
        position: 'left',
        min: 0,
        max: 1,
        grid: { color: '#1e2235' },
        ticks: { color: '#00b0ff', callback: (val) => `${(val * 100).toFixed(0)}%` }
      },
      yLoss: {
        type: 'linear',
        position: 'right',
        grid: { drawOnChartArea: false }, // Avoid layout gridline cluttering
        ticks: { color: '#ff1744', callback: (val) => val.toFixed(3) }
      }
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ─── DATA RENDERING & BACKFILL IMPLEMENTATION (CRASH SHIELD FILTER)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Pre-populates the UI timeline with historical game history data on page refresh
 */
function seedHistoricalTimelineData(historyArray) {
  if (!Array.isArray(historyArray) || historyArray.length === 0) return;

  // Flush legacy memory points
  lossChart.data.labels = [];
  lossChart.data.datasets[0].data = [];
  lossChart.data.datasets[1].data = [];
  telemetryTicks = 0;

  // Backfill timeline using up to the last 30 generated match sets
  const backfillSlice = historyArray.slice(-30);
  backfillSlice.forEach((record) => {
    if (!record) return;
    telemetryTicks++;
    
    // Explicit sanitization fallbacks preventing any undefined property crashes
    const winScore = (record.evaluation_score !== undefined && record.evaluation_score !== null && !isNaN(record.evaluation_score))
      ? Number(record.evaluation_score)
      : 0.50;
      
    const lossValue = (record.loss_metric !== undefined && record.loss_metric !== null && !isNaN(record.loss_metric))
      ? Number(record.loss_metric)
      : 0.015;

    lossChart.data.labels.push(telemetryTicks);
    lossChart.data.datasets[0].data.push(winScore);
    lossChart.data.datasets[1].data.push(lossValue);
  });

  lossChart.update();

  // Populate primary viewport layout with the absolute latest entry block
  const currentActiveGame = historyArray[historyArray.length - 1];
  if (currentActiveGame) {
    updateDashboardDomElements(currentActiveGame);
    processLivePgnDisplay(currentActiveGame.pgn);
    board.setPosition(currentActiveGame.final_fen, false);
    lastRenderedSeed = currentActiveGame.seed;
  }
}

function updateDashboardDomElements(targetRecord) {
  if (!targetRecord) return;

  const result = targetRecord.result || "*";
  const rng = targetRecord.rng || "mulberry32";
  const fen = targetRecord.final_fen || "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  
  // High-Defense Guard Filter Step
  let displayLoss = "0.0000";
  if (targetRecord.loss_metric !== undefined && targetRecord.loss_metric !== null && !isNaN(targetRecord.loss_metric)) {
    displayLoss = Number(targetRecord.loss_metric).toFixed(4);
  }

  document.getElementById("game-result").innerText = result;
  document.getElementById("avg-loss").innerText = displayLoss;
  document.getElementById("epsilon-val").innerText = rng;
  document.getElementById("fen-string").innerText = fen;
  
  const metaContainer = document.getElementById("game-meta");
  if (metaContainer) {
    metaContainer.innerText = `Seed Context: ${targetRecord.seed || 'N/A'} | Framework: ConvNetJS`;
  }
}

function processLivePgnDisplay(pgnText) {
  const logContainer = document.getElementById("log-stream-body");
  if (!logContainer || !pgnText) return;

  if (logContainer.innerText.includes("Awaiting")) {
    logContainer.innerHTML = "";
  }

  const pgnLines = pgnText.split("\n\n");
  const movesOnly = pgnLines[1] || pgnLines[0] || "";
  const cleanDisplay = movesOnly.length > 70 ? `${movesOnly.substring(0, 70)}...` : movesOnly;
  const timestamp = new Date().toLocaleTimeString();

  const newRowHTML = `
    <tr class="border-bottom border-secondary-subtle font-monospace" style="--bs-border-opacity: .05; font-size: 0.72rem;">
      <td class="text-muted">${timestamp}</td>
      <td class="text-info">Telemetry Stream: <span class="text-white">${cleanDisplay}</span></td>
    </tr>
  `;
  
  logContainer.insertAdjacentHTML('afterbegin', newRowHTML);

  if (logContainer.children.length > 6) {
    logContainer.removeChild(logContainer.lastChild);
  }
}

function appendLiveChartPoint(evaluationScore, lossMetric) {
  telemetryTicks++;
  
  const winScore = (evaluationScore !== undefined && evaluationScore !== null && !isNaN(evaluationScore)) 
    ? Number(evaluationScore) 
    : 0.50;
    
  const lossValue = (lossMetric !== undefined && lossMetric !== null && !isNaN(lossMetric)) 
    ? Number(lossMetric) 
    : 0.015;

  lossChart.data.labels.push(telemetryTicks);
  lossChart.data.datasets[0].data.push(winScore);
  lossChart.data.datasets[1].data.push(lossValue);

  if (lossChart.data.labels.length > 35) {
    lossChart.data.labels.shift();
    lossChart.data.datasets[0].data.shift();
    lossChart.data.datasets[1].data.shift();
  }
  lossChart.update('none');
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── ENGINE SYNCHRONIZATION RUNNER & WEBPACK INTERACTIVE EVENT LISTENERS
// ═══════════════════════════════════════════════════════════════════════════
async function checkEngineUpdateCycle() {
  // If user sets status to PAUSE, suspend tracking execution loops
  if (!isStreamTrackingActive) return;

  try {
    const response = await fetch('/api/live-game');
    if (!response.ok) return;

    const dataPayload = await response.json();
    if (!dataPayload) return;

    if (Array.isArray(dataPayload)) {
      if (dataPayload.length === 0) return;
      const latestGame = dataPayload[dataPayload.length - 1];
      if (latestGame && latestGame.seed !== lastRenderedSeed) {
        seedHistoricalTimelineData(dataPayload);
      }
    } else if (dataPayload.final_fen && dataPayload.seed !== lastRenderedSeed) {
      lastRenderedSeed = dataPayload.seed;
      updateDashboardDomElements(dataPayload);
      processLivePgnDisplay(dataPayload.pgn);
      appendLiveChartPoint(dataPayload.evaluation_score, dataPayload.loss_metric);
      await board.setPosition(dataPayload.final_fen, true);
    }
  } catch (err) {
    console.warn("[Dashboard Runtime Monitor] Polling update bypassed: ", err.message);
  }
}

// Global Core Bootstrap Bindings Selector Hook
document.addEventListener("DOMContentLoaded", () => {
  const startBtn = document.getElementById("btn-engine-start");
  const pauseBtn = document.getElementById("btn-engine-pause");
  const resetBtn = document.getElementById("btn-engine-reset");
  const statusLabel = document.getElementById("stream-control-status");

  if (startBtn && pauseBtn && resetBtn) {
    // 🟢 START INTERACTION
    startBtn.addEventListener("click", () => {
      isStreamTrackingActive = true;
      if (statusLabel) {
        statusLabel.innerText = "Status: Active calculation tracking...";
        statusLabel.className = "small text-success font-monospace animate-pulse";
      }
      startBtn.classList.add("active");
      pauseBtn.classList.remove("active");
    });

    // 🟡 PAUSE INTERACTION
    pauseBtn.addEventListener("click", () => {
      isStreamTrackingActive = false;
      if (statusLabel) {
        statusLabel.innerText = "Status: Pipeline tracking suspended.";
        statusLabel.className = "small text-warning font-monospace";
      }
      pauseBtn.classList.add("active");
      startBtn.classList.remove("active");
    });

    // 🔴 RESET VIEW PIPELINE
    resetBtn.addEventListener("click", () => {
      if (!confirm("Are you sure you want to clear your local dashboard analytics history?")) return;

      telemetryTicks = 0;
      lastRenderedSeed = null;
      lossChart.data.labels = [];
      lossChart.data.datasets[0].data = [];
      lossChart.data.datasets[1].data = [];
      lossChart.update();

      const logBody = document.getElementById("log-stream-body");
      if (logBody) {
        logBody.innerHTML = `
          <tr class="font-monospace" style="font-size: 0.72rem;">
            <td colspan="2" class="text-center text-muted py-4">
              <i class="bi bi-trash me-2"></i>Dashboard layout reset. Waiting for active handshake tick...
            </td>
          </tr>
        `;
      }
      document.getElementById("game-result").innerText = "*";
      document.getElementById("avg-loss").innerText = "0.0000";
      board.setPosition("start", true);
      
      if (statusLabel) {
        statusLabel.innerText = "Status: Cache flushed. Awaiting pipeline update...";
        statusLabel.className = "small text-danger font-monospace";
      }
    });
  }

  // Fire polling mechanisms
  checkEngineUpdateCycle();
  setInterval(checkEngineUpdateCycle, 3500); // Poll every 3.5 seconds
});
