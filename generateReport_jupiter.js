// generateReport.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// File paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_FILE = path.join(__dirname, 'runs', 'backtest_real_competition_log.json');
const SNAPSHOT_FILE = path.join(__dirname, 'runs', 'historical_snapshot_with_signature.json');
const BALANCE_FILE = path.join(__dirname, 'balance_state.json');
const SNOWBALL_FILE = path.join(__dirname, 'snowball_state.json');
const PROFIT_LOG_FILE = path.join(__dirname, 'profit_log.json');
const OUTPUT_HTML = path.join(__dirname, 'report.html');
const OUTPUT_JSON = path.join(__dirname, 'report_summary.json');

// Load JSON safely
function loadJSON(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath));
  } catch (err) {
    return fallback;
  }
}

function classifyProfit(gain) {
  if (gain < 1.5) return 'Flicker';
  if (gain < 2.0) return 'Moonshot';
  if (gain < 6.0) return 'Supermoon';
  if (gain < 15.0) return 'Nova';
  return 'Black Hole';
}

export async function generateReport() {
  const log = loadJSON(LOG_FILE, []);
  const snapshot = loadJSON(SNAPSHOT_FILE, []);
  const balances = loadJSON(BALANCE_FILE);
  const snowball = loadJSON(SNOWBALL_FILE);
  const profitLog = loadJSON(PROFIT_LOG_FILE, []);

  const summary = {
    totalTrades: 0,
    profitableTrades: 0,
    tiers: {},
    netProfitSOL: 0,
    netProfitUSD: 0,
    snowball: snowball,
    balances: balances
  };

  const rows = log.map((trade, index) => {
    const token = snapshot.find(t => t.signature === trade.signature);
    const gain = trade.exitPrice / trade.entryPrice;
    const tier = classifyProfit(gain);

    summary.totalTrades++;
    if (gain > 1.0) summary.profitableTrades++;
    summary.tiers[tier] = (summary.tiers[tier] || 0) + 1;
    summary.netProfitSOL += (trade.exitPrice - trade.entryPrice) * trade.amount;

    return `<tr>
      <td>${index + 1}</td>
      <td>${token?.name || 'Unknown'}</td>
      <td>${gain.toFixed(2)}x</td>
      <td>${tier}</td>
      <td>${trade.amount}</td>
      <td>${(trade.exitPrice * trade.amount).toFixed(3)} SOL</td>
    </tr>`;
  });

  const html = `<!DOCTYPE html>
  <html><head><title>Trading Report</title></head>
  <body>
    <h1>🚀 Solana Trading Bot Report</h1>
    <p>Total Trades: ${summary.totalTrades}</p>
    <p>Profitable: ${summary.profitableTrades}</p>
    <p>Net Profit (SOL): ${summary.netProfitSOL.toFixed(3)}</p>
    <h2>Tier Breakdown</h2>
    <ul>
      ${Object.entries(summary.tiers).map(([tier, count]) => `<li>${tier}: ${count}</li>`).join('')}
    </ul>
    <h2>Trade History</h2>
    <table border="1">
      <thead><tr><th>#</th><th>Token</th><th>Gain</th><th>Tier</th><th>Amount</th><th>Profit</th></tr></thead>
      <tbody>
        ${rows.join('')}
      </tbody>
    </table>
  </body></html>`;

  fs.writeFileSync(OUTPUT_HTML, html);
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(summary, null, 2));
  console.log(`✅ Report written to ${OUTPUT_HTML} and ${OUTPUT_JSON}`);
}
