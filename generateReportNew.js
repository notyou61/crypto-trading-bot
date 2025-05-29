// generateReport.js
// Solana Meme Coin Trading Bot Report Generator (ES Module)
// Generates report.html and report_summary.json from real on-chain data
// Node.js v22.14.0, May 2025

import fs from 'fs/promises';
import path from 'path';

// Configuration
const config = {
  OUTPUT_JSON_DIR: './data',
  OUTPUT_HTML_PATH: './data/report.html',
  OUTPUT_SUMMARY_PATH: './data/report_summary.json',
  HISTORICAL_PATH: './data/historical_snapshot_with_signature.json',
  TRADE_LOG_PATH: './data/backtest_real_competition_log.json',
  BALANCE_STATE_PATH: './data/balance_state.json',
  SNOWBALL_STATE_PATH: './data/snowball_state.json',
  PROFIT_LOG_PATH: './data/profit_log.json',
  TRADE_QUANTITY: 10000, // Tokens per trade
  FALLBACK_SOL_PRICE: 100.0, // USD/SOL if no trade data
  MIN_HOT_WALLET_SOL: 1.0,
  MAX_HOT_WALLET_SOL: 3.0,
  MAX_SPENDING_USD: 600,
  HOURS_PER_DAY: 24,
  SPENDING_WALLET_HOURLY_USD: 25,
  PROFIT_SPLIT: { hot: 0.25, payout: 0.25, cold: 0.50 }
};

// Utilities
const formatPrice = (usd, sol) => {
  const usdStr = usd.toFixed(8).replace(/\.?0+$/, '');
  return sol !== undefined ? `$${usdStr} (${sol.toFixed(8)} SOL)` : `$${usdStr}`;
};

const msToSeconds = ms => (ms / 1000).toFixed(0);

const calculateRange = (list, key) => {
  if (!list.length) return { min: 0, max: 0 };
  const vals = list.map(t => t[key]).sort((a, b) => a - b);
  return { min: vals[0], max: vals[vals.length - 1] };
};

const assignTier = (gain, rarityScore = 0) => {
  if (gain > 15 && rarityScore > 0.9) return 'Black Hole';
  if (gain > 6 && rarityScore > 0.75) return 'Nova';
  if (gain > 3 && rarityScore > 0.5) return 'Supermoon';
  if (gain > 1.5) return 'Moonshot';
  return 'Pulse';
};

const rarityIndex = (gainList, targetGain) => {
  const sorted = gainList.slice().sort((a, b) => a - b);
  const rank = sorted.findIndex(g => g >= targetGain);
  return sorted.length ? 1 - (rank / sorted.length) : 0;
};

// Data Loading with Validation
async function loadJson(filePath, defaultValue) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.warn(`⚠️ Failed to load ${filePath}: ${err.message}. Using default.`);
    return defaultValue;
  }
}

async function loadData() {
  const historical = await loadJson(config.HISTORICAL_PATH, []);
  const trades = await loadJson(config.TRADE_LOG_PATH, []);
  const balance = await loadJson(config.BALANCE_STATE_PATH, {
    hotWallet: 0.5, spendingWallet: 0.0, payoutWallet: 0.0, coldWallet: 0.0, lastUpdated: new Date().toISOString()
  });
  const snowball = await loadJson(config.SNOWBALL_STATE_PATH, {
    bankroll: 0.5, status: 'active', tradesExecuted: 0, target: 5.0, lastUpdated: new Date().toISOString()
  });
  const profitLog = await loadJson(config.PROFIT_LOG_PATH, []);

  // Validate data
  if (!Array.isArray(historical)) throw new Error('historical_snapshot_with_signature.json must be an array');
  if (!Array.isArray(trades)) throw new Error('backtest_real_competition_log.json must be an array');
  if (!Array.isArray(profitLog)) throw new Error('profit_log.json must be an array');

  return { historical, trades, balance, snowball, profitLog };
}

// Profit Distribution
async function logProfitDistribution(solPrice, solProfit, usdProfit, toHot, toSpending, toPayout, toCold) {
  const dailyUsdTarget = config.SPENDING_WALLET_HOURLY_USD * config.HOURS_PER_DAY;
  const targetMet = usdProfit >= dailyUsdTarget;

  const logEntry = {
    date: new Date().toISOString().split('T')[0],
    solPrice,
    profitSOL: parseFloat(solProfit.toFixed(6)),
    profitUSD: parseFloat(usdProfit.toFixed(2)),
    walletDistribution: {
      hot: parseFloat(toHot.toFixed(6)),
      spending: parseFloat(toSpending.toFixed(6)),
      payout: parseFloat(toPayout.toFixed(6)),
      cold: parseFloat(toCold.toFixed(6))
    },
    incomeTargetUSD: dailyUsdTarget,
    targetMet
  };

  const profitLog = await loadJson(config.PROFIT_LOG_PATH, []);
  profitLog.push(logEntry);
  try {
    await fs.mkdir(path.dirname(config.PROFIT_LOG_PATH), { recursive: true });
    await fs.writeFile(config.PROFIT_LOG_PATH, JSON.stringify(profitLog, null, 2));
    console.log(`📘 Profit log updated: ${config.PROFIT_LOG_PATH}`);
  } catch (err) {
    console.error(`❌ Failed to write profit log: ${err.message}`);
  }
}

// Main Report Generation
async function generateReport() {
  console.log('INFO: Starting report generation at', new Date().toLocaleString());
  const { historical, trades, balance, snowball, profitLog } = await loadData();

  // Derive SOL price from trades or fallback
  const solPrice = trades.length
    ? trades.reduce((sum, t) => sum + (t.entryPrice + t.exitPrice) / 2, 0) / trades.length / 100 // Approximate USD/SOL
    : config.FALLBACK_SOL_PRICE;
  const priceWarning = solPrice === config.FALLBACK_SOL_PRICE
    ? '<p><strong>Warning:</strong> Using fallback SOL price ($100.00) due to missing trade data.</p>'
    : '';

  // Link trades with token metadata
  const enrichedTrades = trades.map(trade => {
    const tokenData = historical.find(h => h.mint === trade.mint && h.signature === trade.signature) || {};
    const initialPrice = trade.entryPrice || tokenData.initialPrice || 0.00001;
    const peakPrice = tokenData.peakPrice || initialPrice * 2;
    const exitPrice = trade.exitPrice || initialPrice;
    const profit = (exitPrice - initialPrice) * config.TRADE_QUANTITY;
    const profitGain = initialPrice > 0 ? ((exitPrice - initialPrice) / initialPrice) * 100 : 0;
    const tradeTaken = profitGain >= 5; // Simple filter

    return {
      mint: trade.mint,
      signature: trade.signature,
      launchTimestamp: tokenData.timestamp || trade.entryTimestamp || new Date().toISOString(),
      initialPrice,
      peakPrice,
      exitPrice,
      profit,
      profitGain: profitGain.toFixed(2),
      timeToPeakMs: tokenData.timeToPeakMs || 30000,
      collapseTimeMs: tokenData.collapseTimeMs || 60000,
      buyers10s: tokenData.buyers10s || 0,
      buyers30s: tokenData.buyers30s || 0,
      holdDuration: ((new Date(trade.exitTimestamp) - new Date(trade.entryTimestamp)) / 1000) || 60,
      tier: assignTier(profitGain),
      tradeTaken,
      triggeredAtMs: tradeTaken ? (tokenData.timeToPeakMs || 30000) : 0,
      notes: tradeTaken ? 'Trade executed from on-chain data' : 'Skipped due to low profit',
      bankrollAfterTrade: null // Set during snowball
    };
  });

  // Update tiers with rarity
  const gainList = enrichedTrades.filter(t => t.tradeTaken).map(t => parseFloat(t.profitGain));
  enrichedTrades.forEach(t => {
    if (t.tradeTaken) {
      const rarityScore = rarityIndex(gainList, parseFloat(t.profitGain));
      t.tier = assignTier(parseFloat(t.profitGain), rarityScore);
    }
  });

  // Snowball Simulation
  let currentSol = snowball.bankroll;
  let snowballProfit = 0;
  const tradedTokens = enrichedTrades.filter(t => t.tradeTaken);

  console.log(`INFO: Simulating ${tradedTokens.length} trades, initial bankroll: ${currentSol.toFixed(4)} SOL`);
  for (const token of tradedTokens) {
    if (snowball.status !== 'active') break;
    const tradeSize = Math.min(currentSol, 1.5); // Max trade size
    const qty = tradeSize / (token.initialPrice / solPrice); // SOL-based qty
    const returnSol = qty * (token.exitPrice / solPrice);
    const profit = returnSol - tradeSize;

    console.log(`INFO: Trade - Mint: ${token.mint}, Trade Size: ${tradeSize.toFixed(4)} SOL, Profit: ${profit.toFixed(4)} SOL`);
    currentSol += profit;
    snowballProfit += profit;
    token.bankrollAfterTrade = parseFloat(currentSol.toFixed(6));
    snowball.tradesExecuted++;

    if (currentSol >= snowball.target) {
      snowball.status = 'reserve_mode';
      console.log(`🎯 Snowball target reached: ${currentSol.toFixed(4)} SOL`);
      break;
    }
  }

  // Reserve Mode Profit Distribution
  let reserveSummary = '';
  let spendingPayout = '';
  if (snowball.status === 'reserve_mode') {
    const usdProfit = snowballProfit * solPrice;
    const dailyUsdTarget = config.SPENDING_WALLET_HOURLY_USD * config.HOURS_PER_DAY;
    const maxSpendingSOL = config.MAX_SPENDING_USD / solPrice;
    const spendingGap = Math.max(0, maxSpendingSOL - balance.spendingWallet);

    let toHot = 0, toSpending = 0, toPayout = 0, toCold = 0;
    if (balance.hotWallet < config.MAX_HOT_WALLET_SOL) {
      toHot = Math.min(snowballProfit, config.MAX_HOT_WALLET_SOL - balance.hotWallet);
      const remaining = snowballProfit - toHot;
      toSpending = Math.min(remaining * 0.25, spendingGap);
      toPayout = remaining * 0.25;
      toCold = remaining * 0.50;
    } else {
      toSpending = Math.min(snowballProfit * 0.25, spendingGap);
      const deficit = snowballProfit * 0.25 - toSpending;
      toPayout = snowballProfit * 0.25 + deficit * 0.5;
      toCold = snowballProfit * 0.50 + deficit * 0.5;
    }

    balance.hotWallet += toHot;
    balance.spendingWallet += toSpending;
    balance.payoutWallet += toPayout;
    balance.coldWallet += toCold;

    // Ensure hot wallet floor
    if (balance.hotWallet < config.MIN_HOT_WALLET_SOL) {
      const shortfall = config.MIN_HOT_WALLET_SOL - balance.hotWallet;
      if (balance.payoutWallet >= shortfall) {
        balance.payoutWallet -= shortfall;
        toPayout -= shortfall;
      } else if (balance.coldWallet >= shortfall) {
        balance.coldWallet -= shortfall;
        toCold -= shortfall;
      }
    }
    balance.hotWallet = Math.min(balance.hotWallet, config.MAX_HOT_WALLET_SOL);

    spendingPayout = toSpending > 0
      ? `<p><strong>Spending Payout:</strong> Transferred ${toSpending.toFixed(4)} SOL (~$${(toSpending * solPrice).toFixed(2)}) to Spending Wallet.</p>`
      : `<p><strong>Spending Payout:</strong> No transfer needed; Spending Wallet at ${balance.spendingWallet.toFixed(4)} SOL.</p>`;

    await logProfitDistribution(solPrice, snowballProfit, usdProfit, toHot, toSpending, toPayout, toCold);

    reserveSummary = `
      <p><strong>Reserve Mode:</strong> Distributed <span class="highlight">${snowballProfit.toFixed(4)} SOL</span> (~$${(snowballProfit * solPrice).toFixed(2)}):</p>
      <ul>
        <li><strong>Hot Wallet</strong>: ${toHot.toFixed(4)} SOL</li>
        <li><strong>Spending Wallet</strong>: ${toSpending.toFixed(4)} SOL</li>
        <li><strong>Payout Wallet</strong>: ${toPayout.toFixed(4)} SOL</li>
        <li><strong>Cold Storage</strong>: ${toCold.toFixed(4)} SOL</li>
      </ul>
      <p><strong>Wallet Balances</strong>:</p>
      <ul>
        <li><strong>Hot Wallet</strong>: ${balance.hotWallet.toFixed(4)} SOL (~$${(balance.hotWallet * solPrice).toFixed(2)})</li>
        <li><strong>Spending Wallet</strong>: ${balance.spendingWallet.toFixed(4)} SOL (~$${(balance.spendingWallet * solPrice).toFixed(2)})</li>
        <li><strong>Payout Wallet</strong>: ${balance.payoutWallet.toFixed(4)} SOL (~$${(balance.payoutWallet * solPrice).toFixed(2)})</li>
        <li><strong>Cold Storage</strong>: ${balance.coldWallet.toFixed(4)} SOL (~$${(balance.coldWallet * solPrice).toFixed(2)})</li>
      </ul>
      ${spendingPayout}
    `;
  }

  // Save updated states
  snowball.bankroll = currentSol;
  snowball.lastUpdated = new Date().toISOString();
  balance.lastUpdated = new Date().toISOString();
  try {
    await fs.mkdir(config.OUTPUT_JSON_DIR, { recursive: true });
    await fs.writeFile(config.SNOWBALL_STATE_PATH, JSON.stringify(snowball, null, 2));
    await fs.writeFile(config.BALANCE_STATE_PATH, JSON.stringify(balance, null, 2));
  } catch (err) {
    console.error(`❌ Failed to save state: ${err.message}`);
  }

  // Aggregate Metrics
  const tiers = ['Skipped', 'Pulse', 'Moonshot', 'Supermoon', 'Nova', 'Black Hole'];
  const tierData = tiers.reduce((acc, tier) => {
    const group = enrichedTrades.filter(t => (tier === 'Skipped' ? !t.tradeTaken : t.tier === tier && t.tradeTaken));
    const profitUsd = group.reduce((sum, t) => sum + t.profit, 0);
    acc[tier] = {
      count: group.length,
      profitUsd,
      profitSol: profitUsd / solPrice,
      share: enrichedTrades.length ? (group.length / enrichedTrades.length * 100) : 0
    };
    return acc;
  }, {});

  const totalProfitUsd = tradedTokens.reduce((sum, t) => sum + t.profit, 0);
  const totalProfitSol = totalProfitUsd / solPrice;
  const timeRange = enrichedTrades.length
    ? `${new Date(calculateRange(enrichedTrades, 'launchTimestamp').min).toLocaleString()} to ${new Date(calculateRange(enrichedTrades, 'launchTimestamp').max).toLocaleTimeString()}`
    : 'N/A';

  // Generate report_summary.json
  const summary = {
    timestamp: new Date().toISOString(),
    totalTokens: enrichedTrades.length,
    tradesExecuted: tradedTokens.length,
    solPrice,
    totalProfit: { usd: totalProfitUsd.toFixed(2), sol: totalProfitSol.toFixed(6) },
    snowball: {
      initialBankroll: 0.5,
      finalBankroll: currentSol.toFixed(6),
      profit: snowballProfit.toFixed(6),
      trades: snowball.tradesExecuted,
      status: snowball.status
    },
    tiers: tierData,
    walletBalances: {
      hot: balance.hotWallet.toFixed(6),
      spending: balance.spendingWallet.toFixed(6),
      payout: balance.payoutWallet.toFixed(6),
      cold: balance.coldWallet.toFixed(6)
    }
  };
  try {
    await fs.writeFile(config.OUTPUT_SUMMARY_PATH, JSON.stringify(summary, null, 2));
    console.log(`📄 Summary saved: ${config.OUTPUT_SUMMARY_PATH}`);
  } catch (err) {
    console.error(`❌ Failed to write summary: ${err.message}`);
  }

  // Generate report.html
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Solana Meme Coin Trading Report</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f5f5f5; color: #333; margin: 0; padding: 20px; }
    .container { max-width: 800px; margin: 0 auto; background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
    h1, h2, h3 { color: #0077b6; }
    h1 { text-align: center; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #e6f0fa; }
    tr:hover { background: #f0f4f8; }
    .highlight { color: #00a86b; font-weight: bold; }
    .section { margin: 20px 0; }
    .summary { padding: 15px; background: #f9f9f9; border-radius: 8px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Solana Meme Coin Trading Report</h1>
    <div class="section summary">
      <h2>Summary</h2>
      ${priceWarning}
      <p>Analyzed <span class="highlight">${enrichedTrades.length}</span> tokens from <span class="highlight">${timeRange}</span>. Executed <span class="highlight">${tradedTokens.length}</span> trades, skipped <span class="highlight">${tierData.Skipped.count}</span>.</p>
      <p>Total profit: <span class="highlight">$${totalProfitUsd.toFixed(2)}</span> (<span class="highlight">${totalProfitSol.toFixed(6)} SOL</span>) at SOL price <span class="highlight">$${solPrice.toFixed(2)}</span>.</p>
      <p><strong>Snowball:</strong> From <span class="highlight">${(0.5).toFixed(4)}</span> SOL to <span class="highlight">${currentSol.toFixed(4)}</span> SOL, profit <span class="highlight">${snowballProfit.toFixed(4)}</span> SOL in ${snowball.tradesExecuted} trades.</p>
      ${reserveSummary}
    </div>
    <div class="section">
      <h2>Tier Breakdown</h2>
      <table>
        <tr><th>Tier</th><th>Count</th><th>Profit (USD)</th><th>Profit (SOL)</th><th>Share</th></tr>
        ${tiers.map(tier => `
          <tr>
            <td>${tier}</td>
            <td>${tierData[tier].count}</td>
            <td>$${tierData[tier].profitUsd.toFixed(2)}</td>
            <td>${tierData[tier].profitSol.toFixed(6)}</td>
            <td>${tierData[tier].share.toFixed(2)}%</td>
          </tr>
        `).join('')}
      </table>
    </div>
    ${enrichedTrades.map((t, i) => `
      <div class="section">
        <h2>Token ${i + 1}</h2>
        <table>
          <tr><th>Metric</th><th>Value</th></tr>
          <tr><td>Mint</td><td>${t.mint}</td></tr>
          <tr><td>Signature</td><td>${t.signature}</td></tr>
          <tr><td>Launch</td><td>${new Date(t.launchTimestamp).toLocaleString()}</td></tr>
          <tr><td>Initial Price</td><td>${formatPrice(t.initialPrice, t.initialPrice / solPrice)}</td></tr>
          <tr><td>Peak Price</td><td>${formatPrice(t.peakPrice, t.peakPrice / solPrice)}</td></tr>
          <tr><td>Exit Price</td><td>${formatPrice(t.exitPrice, t.exitPrice / solPrice)}</td></tr>
          <tr><td>Profit</td><td>${formatPrice(t.profit, t.profit / solPrice)}</td></tr>
          <tr><td>Profit Gain</td><td>${t.profitGain}%</td></tr>
          <tr><td>Tier</td><td>${t.tradeTaken ? t.tier : 'Skipped'}</td></tr>
          <tr><td>Notes</td><td>${t.notes}</td></tr>
          ${t.bankrollAfterTrade ? `<tr><td>Bankroll After</td><td>${t.bankrollAfterTrade} SOL</td></tr>` : ''}
        </table>
      </div>
    `).join('')}
  </div>
</body>
</html>
`;

  try {
    await fs.writeFile(config.OUTPUT_HTML_PATH, html);
    console.log(`📊 HTML report saved: ${config.OUTPUT_HTML_PATH}`);
  } catch (err) {
    console.error(`❌ Failed to write HTML: ${err.message}`);
  }
}

// Run
try {
  await fs.mkdir(config.OUTPUT_JSON_DIR, { recursive: true });
  await generateReport();
  console.log('✅ Report generation complete');
} catch (err) {
  console.error(`❌ Fatal error: ${err.message}`);
  process.exit(1);
}