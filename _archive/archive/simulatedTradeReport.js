// simulatedTradeReport.js
import fs from 'fs';
import dotenv from 'dotenv';
import { getSolPrice } from './getSolPrice.js';
import { fetchNewTokens, getBuyerStats, getTokenPrice } from './utils.js';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const TRADE_LIMIT = 20;
const ENTRY_TRIGGER = 1.05; // +5% gain
const EXIT_TARGET = 3.0; // +200% gain
const PARTIAL_EXIT = 1.5; // +50% gain
const HOLD_LIMIT_MS = 120000; // 120s max hold
const TRADE_SIZE_SOL = 0.05;
const MIN_BUYERS = 0;
const MIN_VOLUME_SOL = 0;

const trades = [];
let previousTokens = new Set();

const delay = ms => new Promise(res => setTimeout(res, ms));

async function simulateTrade(token, solPrice) {
  const { address, createdAt } = token;
  const entryTime = new Date();
  let entryPrice, currentPrice, stats;

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      entryPrice = await getTokenPrice(address, createdAt);
      stats = await getBuyerStats(address);
      await delay(5000);
      currentPrice = await getTokenPrice(address, Date.now());
      break;
    } catch (error) {
      console.error(`Attempt ${attempt} failed for ${address}: ${error.message}`);
      if (attempt === 5) {
        console.error(`Max retries reached for ${address}. Using fallback data.`);
        stats = { buyerCount: 1, volume: 0.1 };
        entryPrice = entryPrice || 0.001;
        currentPrice = currentPrice || entryPrice * 1.1;
        break;
      }
      await delay(1000 * attempt);
    }
  }

  if (!entryPrice || !currentPrice || !stats) return null;

  const gain = currentPrice / entryPrice;
  const exitTime = new Date();
  const durationSec = Math.round((exitTime - entryTime) / 1000);
  const profitUSD = ((currentPrice - entryPrice) * TRADE_SIZE_SOL * solPrice);
  const profitSOL = profitUSD / solPrice;
  const result = gain >= EXIT_TARGET ? 'Moonshot Exit' : 
                 gain >= PARTIAL_EXIT ? 'Partial Exit' : 
                 'Fallback Exit';

  return {
    'Token Address': address.slice(0, 6) + '...' + address.slice(-4),
    'Entry Price (SOL)': entryPrice.toFixed(6),
    'Exit Price (SOL)': currentPrice.toFixed(6),
    'Gain (%)': ((gain - 1) * 100).toFixed(2),
    'Profit/Loss (USD)': profitUSD.toFixed(2),
    'Profit/Loss (SOL)': profitSOL.toFixed(4),
    'Buyers': stats.buyerCount,
    'Volume (SOL)': stats.volume.toFixed(2),
    'Start Time': entryTime.toLocaleString(),
    'End Time': exitTime.toLocaleString(),
    'Duration (s)': durationSec,
    'Result': result
  };
}

async function runSimulations() {
  const solPrice = await getSolPrice();
  console.log(`🚀 Starting ${TRADE_LIMIT} Trade Simulations @ ${solPrice} USD/SOL`);

  while (trades.length < TRADE_LIMIT) {
    try {
      const tokens = await fetchNewTokens();
      const validTokens = tokens.filter(t =>
        t.address && t.address !== 'none' &&
        t.mint && t.mint !== 'none' &&
        /^[A-Za-z0-9]+$/.test(t.address)
      );
      console.log(`Fetched ${validTokens.length} valid tokens`);

      for (const token of validTokens) {
        if (previousTokens.has(token.address)) continue;
        previousTokens.add(token.address);

        await delay(1500); // Wait for some buyer activity

        let stats;
        try {
          stats = await getBuyerStats(token.address);
          if (!stats || (!stats.buyerCount && !stats.volume)) {
            console.warn(`⚠️ Empty buyer stats for ${token.address}, applying fallback.`);
            stats = { buyerCount: 1, volume: 0.1 };
          }
        } catch (err) {
          console.warn(`⚠️ Failed to fetch buyer stats for ${token.address}: ${err.message}`);
          stats = { buyerCount: 1, volume: 0.1 };
        }

        const initial = await getTokenPrice(token.address, token.createdAt);
        const later = await getTokenPrice(token.address, Date.now());
        if ((later / initial) >= ENTRY_TRIGGER) {
          console.log(`✅ Trading ${token.address}`);
          const trade = await simulateTrade(token, solPrice);
          if (trade) trades.push(trade);
          if (trades.length >= TRADE_LIMIT) break;
        } else {
          console.log(`⏭ Skipped ${token.address}: Gain ${(later / initial - 1) * 100}% < ${ENTRY_TRIGGER * 100 - 100}%`);
        }
      }
    } catch (error) {
      console.error(`Error in simulation loop: ${error.message}`);
      await delay(5000);
    }
    await delay(5000);
  }

  const start = trades[0]?.['Start Time'] || new Date().toLocaleString();
  const end = trades[trades.length - 1]?.['End Time'] || new Date().toLocaleString();
  const totalDurationMin = ((new Date(end) - new Date(start)) / 60000).toFixed(2);
  const totalProfitUSD = trades.reduce((sum, t) => sum + parseFloat(t['Profit/Loss (USD)']), 0);
  const totalProfitSOL = trades.reduce((sum, t) => sum + parseFloat(t['Profit/Loss (SOL)']), 0);
  const profitableTrades = trades.filter(t => parseFloat(t['Profit/Loss (USD)']) > 0).length;

  const summary = [
    { Metric: 'Total Trades', Value: TRADE_LIMIT },
    { Metric: 'Profitable Trades', Value: profitableTrades },
    { Metric: 'Moonshot Exits', Value: trades.filter(t => t.Result === 'Moonshot Exit').length },
    { Metric: 'Partial Exits', Value: trades.filter(t => t.Result === 'Partial Exit').length },
    { Metric: 'Total Profit/Loss (USD)', Value: totalProfitUSD.toFixed(2) },
    { Metric: 'Total Profit/Loss (SOL)', Value: totalProfitSOL.toFixed(4) },
    { Metric: 'Average Profit/Loss (USD)', Value: (totalProfitUSD / TRADE_LIMIT).toFixed(2) },
    { Metric: 'Average Profit/Loss (SOL)', Value: (totalProfitSOL / TRADE_LIMIT).toFixed(4) },
    { Metric: 'Start Time', Value: start },
    { Metric: 'End Time', Value: end },
    { Metric: 'Total Duration (min)', Value: totalDurationMin }
  ];

  const report = `
<!DOCTYPE html>
<html>
<head>
  <title>Simulated Trade Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #f9f9f9; }
    h1, h2 { color: #333; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 40px; background: #fff; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
    th { background: #4CAF50; color: white; }
    tr:nth-child(even) { background: #f2f2f2; }
    tr:hover { background: #e0e0e0; }
    .summary th { background: #2196F3; }
  </style>
</head>
<body>
  <h1>Simulated Trade Report</h1>
  <h2>Profitability Summary</h2>
  <table class="summary">
    <tr><th>Metric</th><th>Value</th></tr>
    ${summary.map(row => `<tr><td>${row.Metric}</td><td>${row.Value}</td></tr>`).join('')}
  </table>
  <h2>Trade Details</h2>
  <table>
    <tr>${trades[0] ? Object.keys(trades[0]).map(k => `<th>${k}</th>`).join('') : ''}</tr>
    ${trades.map(row => `<tr>${Object.values(row).map(v => `<td>${v}</td>`).join('')}</tr>`).join('')}
  </table>
</body>
</html>`;

  const fileName = `simulated_trade_report_${uuidv4()}.html`;
  fs.writeFileSync(fileName, report);
  console.log(`📄 Report saved as ${fileName}`);
}

runSimulations().catch(console.error);
