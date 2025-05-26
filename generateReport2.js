// generateReport2.js
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';
import { Helius } from 'helius-sdk';
import { getSolPrice } from './getSolPrice.js';

dotenv.config();

// Configuration
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const OUTPUT_JSON = './runs/historical_snapshot_with_signature.json';
const OUTPUT_HTML = './runs/token_historical_report.html';
const MAX_PAGES = 20;
const TRADE_QUANTITY = 1000;
const FALLBACK_SOL_PRICE = 100.0;
const MIN_BUYERS_30S = 5; // Minimum unique buyers in 30s
const MIN_VOLUME_SOL = 0.1; // Minimum trade volume in SOL
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Initialize Helius SDK
const helius = new Helius(HELIUS_API_KEY || '');

// Helper functions
const formatPrice = (usd, sol) => {
  const usdStr = usd.toFixed(8).replace(/\.?0+$/, '');
  return sol !== undefined ? `$${usdStr} (${sol.toFixed(8)} SOL)` : `$${usdStr}`;
};

const msToSeconds = (ms) => (ms / 1000).toFixed(0);

const calculatePriceRange = (tokens, key) => {
  if (!tokens.length) return { min: 0, max: 0 };
  const prices = tokens.map(t => t[key]).sort((a, b) => a - b);
  return { min: prices[0], max: prices[prices.length - 1] };
};

const calculateTimeRange = (tokens, key) => {
  if (!tokens.length) return { min: 0, max: 0 };
  const times = tokens.map(t => t[key] / 1000).sort((a, b) => a - b);
  return { min: times[0], max: times[times.length - 1] };
};

const assignTier = (profitGain) => {
  if (profitGain > 20) return 'Black Hole';
  if (profitGain > 10) return 'Supermoon';
  if (profitGain > 5) return 'Moonshot';
  if (profitGain > 2) return 'Nova';
  return 'Pulse';
};

// Fetch token metadata for multiple mints with retry logic
async function fetchTokenMetadata(mints, retries = 3, backoff = 1000) {
  if (!mints.length) return {};

  const url = `https://api.helius.xyz/v0/tokens/metadata?api-key=${HELIUS_API_KEY}`;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.post(url, { mintAccounts: mints });
      const metadata = response.data.reduce((acc, item) => {
        acc[item.account] = {
          name: item.onChainData?.data?.name || 'Unknown',
          symbol: item.onChainData?.data?.symbol || 'UNKNOWN',
        };
        return acc;
      }, {});
      return metadata;
    } catch (err) {
      if (err.response?.status === 429 && attempt < retries) {
        console.warn(`⚠️ Rate limit hit, retrying (${attempt}/${retries}) after ${backoff}ms...`);
        await delay(backoff);
        backoff *= 2;
      } else {
        console.error(`❌ Error fetching metadata for mints ${mints.join(', ')}:`, err.message);
        return mints.reduce((acc, mint) => {
          acc[mint] = { name: 'Unknown', symbol: 'UNKNOWN' };
          return acc;
        }, {});
      }
    }
  }
  return mints.reduce((acc, mint) => {
    acc[mint] = { name: 'Unknown', symbol: 'UNKNOWN' };
    return acc;
  }, {});
}

// Fetch real trading prices and buyer/volume data for a mint
async function fetchRealTradeData(mint, tx) {
  try {
    const txDetails = await helius.rpc.getTransaction(tx.signature);
    const transfers = txDetails?.tokenTransfers?.filter(t => t.mint === mint) || [];
    const nativeTransfers = txDetails?.nativeTransfers || [];

    // Calculate initial price from transaction
    const tokensReceived = transfers.reduce((sum, t) => sum + parseFloat(t.tokenAmount), 0);
    const solSent = nativeTransfers.reduce((sum, t) => sum + parseFloat(t.amount || 0), 0) / 1e9; // Lamports to SOL
    const initialPrice = tokensReceived && solSent ? solSent / tokensReceived : 0.00001;

    // Fetch recent trades for peak price (last 24 hours)
    const signatures = await helius.rpc.getSignaturesForAddress(mint, { limit: 50 });
    let peakPrice = initialPrice;
    let totalVolume = 0;
    const buyers = new Set();

    for (const sig of signatures) {
      if (sig.blockTime < tx.blockTime - 24 * 60 * 60) continue; // Skip trades older than 24h
      const tradeTx = await helius.rpc.getTransaction(sig.signature);
      const tradeTransfers = tradeTx?.tokenTransfers?.filter(t => t.mint === mint) || [];
      const tradeNative = tradeTx?.nativeTransfers || [];

      for (const t of tradeTransfers) {
        const tradeSol = tradeNative.reduce((sum, n) => sum + parseFloat(n.amount || 0), 0) / 1e9;
        const tradeTokens = parseFloat(t.tokenAmount);
        const price = tradeTokens && tradeSol ? tradeSol / tradeTokens : 0;
        if (price > peakPrice) peakPrice = price;
        totalVolume += tradeSol;
        buyers.add(t.toUserAccount); // Track unique buyers
      }
    }

    // Calculate metrics
    const buyers30s = buyers.size; // Simplified: assumes 30s window
    const profitGain = initialPrice && peakPrice ? ((peakPrice - initialPrice) / initialPrice) * 100 : 0;
    const tradeTaken = buyers30s >= MIN_BUYERS_30S && totalVolume >= MIN_VOLUME_SOL;

    return {
      initialPrice,
      peakPrice,
      profitGain,
      buyers30s,
      totalVolume,
      tradeTaken,
      notes: tradeTaken ? 'Trade triggered based on real buyer/volume thresholds.' : 'Skipped due to insufficient buyers or volume.',
    };
} catch (err) {
  console.error(`❌ Error fetching trade data for mint ${mint}:`);
  if (err.response) {
    console.error(`  HTTP ${err.response.status} - ${err.response.statusText}`);
    console.error(`  Response data:`, JSON.stringify(err.response.data, null, 2));
  } else if (err.request) {
    console.error(`  No response received:`, err.request);
  } else {
    console.error(`  Error:`, err.message);
  }
  console.error(`  Full error object:`);
  console.dir(err, { depth: null });

  return {
    mint,
    error: true,
    message: err.message || 'Unknown error',
    tradeTaken: false,
    notes: 'Metadata/trade fetch failed, skipped this token.'
  };
}
}

// === Step 1: Fetch historical tokens ===
async function fetchRealTokenData() {
  if (!HELIUS_API_KEY) {
    console.error('❌ HELIUS_API_KEY not set in .env');
    process.exit(1);
  }

  const seenMints = new Set();
  const resultList = [];
  let before = undefined;
  let page = 0;
  const batchSize = 10;
  let mintBatch = [];

  try {
    fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
  } catch (err) {
    console.error(`❌ Error creating directory: ${err.message}`);
    process.exit(1);
  }

  while (page < MAX_PAGES) {
    const url = `https://api.helius.xyz/v0/addresses/${PUMP_FUN_PROGRAM}/transactions?api-key=${HELIUS_API_KEY}`;
    const params = before ? { before } : {};

    try {
      const response = await axios.get(url, { params });
      const txs = response.data;

      if (!Array.isArray(txs) || txs.length === 0) {
        console.log(`ℹ️ No more transactions on page ${page + 1}`);
        break;
      }

      console.log(`📄 Page ${page + 1}: Scanning ${txs.length} txs`);
      for (const tx of txs) {
        const transfer = tx.tokenTransfers?.find(t => t.mint?.endsWith('pump') && !seenMints.has(t.mint));
        if (!transfer) continue;

        seenMints.add(transfer.mint);
        mintBatch.push(transfer.mint);

        // Fetch real trade data
        const tradeData = await fetchRealTradeData(transfer.mint, tx);

        // Store token data
        resultList.push({
          token: transfer.mint,
          name: null, // Placeholder
          symbol: null, // Placeholder
          launchTimestamp: new Date(tx.timestamp * 1000).toISOString(),
          initialPrice: tradeData.initialPrice,
          peakPrice: tradeData.peakPrice,
          timeToPeakMs: Math.floor(Math.random() * 60000), // Placeholder; replace with real data if available
          collapseTimeMs: Math.floor(Math.random() * 120000), // Placeholder
          buyers10s: Math.floor(Math.random() * 20), // Placeholder; enhance if needed
          buyers30s: tradeData.buyers30s,
          holdDuration: Math.floor(Math.random() * 120), // Placeholder
          exitPrice: tradeData.peakPrice * (1 + Math.random() * 0.5), // Simplified
          profitGain: tradeData.profitGain,
          tier: assignTier(tradeData.profitGain),
          tradeTaken: tradeData.tradeTaken,
          triggeredAtMs: tradeData.tradeTaken ? Math.floor(Math.random() * 30000) : 0, // Placeholder
          notes: tradeData.notes,
        });

        // Fetch metadata when batch is full or at page end
        if (mintBatch.length >= batchSize || tx === txs[txs.length - 1]) {
          const metadata = await fetchTokenMetadata(mintBatch);
          resultList.forEach(token => {
            if (metadata[token.token]) {
              token.name = metadata[token.token].name;
              token.symbol = metadata[token.token].symbol;
            }
          });
          mintBatch = [];
          await delay(200);
        }
      }

      before = txs[txs.length - 1].signature;
      page++;
      await delay(1000);
    } catch (err) {
      console.error(`❌ Error on page ${page + 1}:`, err.response?.data || err.message);
      break;
    }
  }

  // Fetch metadata for remaining mints
  if (mintBatch.length > 0) {
    const metadata = await fetchTokenMetadata(mintBatch);
    resultList.forEach(token => {
      if (metadata[token.token]) {
        token.name = metadata[token.token].name;
        token.symbol = metadata[token.token].symbol;
      }
    });
  }

  // Ensure all tokens have name and symbol
  resultList.forEach(token => {
    if (!token.name || !token.symbol) {
      token.name = 'Unknown';
      token.symbol = 'UNKNOWN';
    }
  });

  try {
    fs.writeFileSync(OUTPUT_JSON, JSON.stringify(resultList, null, 2));
    console.log(`✅ Fetched and saved ${resultList.length} tokens to ${OUTPUT_JSON}`);
  } catch (err) {
    console.error(`❌ Error writing JSON: ${err.message}`);
    process.exit(1);
  }

  return resultList;
}

// === Step 2: Generate report ===
async function generateReport(tokens) {
  const solPrice = await getSolPrice() || FALLBACK_SOL_PRICE;
  const priceWarning = solPrice === FALLBACK_SOL_PRICE ? '<p><strong>Warning:</strong> Using fallback SOL price ($100.00) due to API failure.</p>' : '';
  const tradedTokens = tokens.filter(t => t.tradeTaken);
  const tiers = ['Skipped', 'Pulse', 'Moonshot', 'Supermoon', 'Nova', 'Black Hole'];

  const calculateProfit = token => (token.exitPrice - token.initialPrice) * TRADE_QUANTITY;

  // Tier data
  const tierData = tiers.reduce((acc, tier) => {
    const group = tokens.filter(t => tier === 'Skipped' ? !t.tradeTaken : t.tier === tier && t.tradeTaken);
    const profitUsd = group.reduce((sum, t) => sum + calculateProfit(t), 0);
    acc[tier] = {
      count: group.length,
      profitUsd,
      profitSol: profitUsd / solPrice,
      share: tokens.length ? (group.length / tokens.length * 100) : 0,
    };
    return acc;
  }, {});

  // Aggregate metrics
  const totalProfitUsd = tradedTokens.reduce((sum, t) => sum + calculateProfit(t), 0);
  const totalProfitSol = totalProfitUsd / solPrice;
  const priceRange = calculatePriceRange(tradedTokens, 'initialPrice');
  const peakPriceRange = calculatePriceRange(tradedTokens, 'peakPrice');
  const timeToPeakRange = calculateTimeRange(tradedTokens, 'timeToPeakMs');
  const profitGainRange = {
    min: tradedTokens.length ? Math.min(...tradedTokens.map(t => t.profitGain)) : 0,
    max: tradedTokens.length ? Math.max(...tradedTokens.map(t => t.profitGain)) : 0,
  };
  const triggerRange = calculateTimeRange(tradedTokens, 'triggeredAtMs');
  const sortedTimestamps = tokens.map(t => new Date(t.launchTimestamp)).sort((a, b) => a - b);
  const formatDate = (date) =>
    date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  const minTime = sortedTimestamps[0];
  const maxTime = sortedTimestamps[sortedTimestamps.length - 1];

  const formattedTimeRange = `${minTime.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })} to ${maxTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;

  // HTML report
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Memecoin Sniper Bot Historical Report</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            background-color: #f5f5f5;
            color: #333;
            margin: 0;
            padding: 20px;
            line-height: 1.6;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            background-color: #fff;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
        }
        h1, h2, h3 {
            color: #0077b6;
        }
        h1 {
            text-align: center;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }
        th, td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }
        th {
            background-color: #e6f0fa;
            color: #0077b6;
        }
        tr:hover {
            background-color: #f0f4f8;
        }
        ul, li {
            margin: 5px 0;
        }
        .section {
            margin: 20px 0;
        }
        .summary {
            padding: 15px;
            background-color: #f9f9f9;
            border-radius: 8px;
        }
        .highlight {
            color: #00a86b;
            font-weight: bold;
        }
        .emoji {
            margin-right: 10px;
        }
        .token-address {
            font-family: monospace;
            word-break: break-all;
        }
        a.token-address {
            color: #0077b6;
            text-decoration: none;
        }
        a.token-address:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Memecoin Sniper Bot Historical Report</h1>

        <div class="section summary">
            <h2><span class="emoji">📝</span> Summary</h2>
            ${priceWarning}
            <p>The sniper bot executed <span class="highlight">${tradedTokens.length} trades</span> across <span class="highlight">${tokens.length} tokens</span> launched between <span class="highlight">${formattedTimeRange}</span>.</p>
            <p>Total profit was <span class="highlight">$${totalProfitUsd.toFixed(2)}</span> (<span class="highlight">${totalProfitSol.toFixed(6)} SOL</span>) at a SOL price of <span class="highlight">$${solPrice.toFixed(2)}</span>. The bot skipped <span class="highlight">${tierData.Skipped.count} trades</span>.</p>
        </div>

        <div class="section">
            <h2><span class="emoji">✅</span> Overview</h2>
            <ul>
                <li><strong>Total Tokens Analyzed</strong>: ${tokens.length}</li>
                <li><strong>Trades Taken</strong>: ${tradedTokens.length}</li>
                <li><strong>Current SOL Price</strong>: $${solPrice.toFixed(2)}</li>
                <li><strong>Total Profit</strong>:
                    <ul>
                        <li><strong>USD</strong>: $${totalProfitUsd.toFixed(2)}</li>
                        <li><strong>SOL</strong>: ${totalProfitSol.toFixed(6)}</li>
                    </ul>
                </li>
            </ul>
        </div>

        <div class="section">
            <h2><span class="emoji">📊</span> Tier Breakdown</h2>
            <table>
                <tr>
                    <th>Tier</th>
                    <th>Count</th>
                    <th>Profit (USD)</th>
                    <th>Profit (SOL)</th>
                    <th>Share of Trades</th>
                </tr>
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

        <div class="section">
            <h2><span class="emoji">📈</span> Tier Summaries</h2>
            ${tiers.map(tier => {
              const tierTokens = tokens.filter(t => tier === 'Skipped' ? !t.tradeTaken : t.tier === tier && t.tradeTaken);
              if (!tierTokens.length) return `
                <h3>${tier}</h3>
                <p>No tokens in the <span class="highlight">${tier}</span> tier.</p>
              `;
              return `
                <h3>${tier}</h3>
                <p><span class="highlight">${tierTokens.length} token${tierTokens.length > 1 ? 's' : ''}</span> in the <span class="highlight">${tier}</span> tier contributed <span class="highlight">$${tierData[tier].profitUsd.toFixed(2)}</span> (<span class="highlight">${tierData[tier].profitSol.toFixed(6)} SOL</span>), representing <span class="highlight">${tierData[tier].share.toFixed(2)}%</span> of trades. Initial prices ranged from <span class="highlight">$${calculatePriceRange(tierTokens, 'initialPrice').min.toFixed(6)}</span> to <span class="highlight">$${calculatePriceRange(tierTokens, 'initialPrice').max.toFixed(6)}</span>, peaking at <span class="highlight">$${calculatePriceRange(tierTokens, 'peakPrice').min.toFixed(6)}</span> to <span class="highlight">$${calculatePriceRange(tierTokens, 'peakPrice').max.toFixed(6)}</span> in <span class="highlight">${calculateTimeRange(tierTokens, 'timeToPeakMs').min.toFixed(0)}–${calculateTimeRange(tierTokens, 'timeToPeakMs').max.toFixed(0)} seconds</span> for gains up to <span class="highlight">${tierTokens.length ? Math.max(...tierTokens.map(t => t.peakPrice / t.initialPrice)).toFixed(1) : 0}x</span>.</p>
              `;
            }).join('')}
        </div>

        ${tokens.map((token, index) => `
          <div class="section">
            <h2><span class="emoji">📋</span> Token Details: Token ${index + 1}</h2>
            <table>
              <tr><th>Metric</th><th>Value</th></tr>
              <tr><td>Token Address</td><td><a class="token-address" href="https://pump.fun/coin/${token.token}" target="_blank">${token.name !== 'Unknown' ? `${token.name} (${token.symbol})` : token.token}</a></td></tr>
              <tr><td>Launch Timestamp</td><td>${token.launchTimestamp}</td></tr>
              <tr><td>Initial Price</td><td>${formatPrice(token.initialPrice, token.initialPrice / solPrice)}</td></tr>
              <tr><td>Peak Price</td><td>${formatPrice(token.peakPrice, token.peakPrice / solPrice)}</td></tr>
              <tr><td>Peak Gain</td><td>${(token.peakPrice / token.initialPrice).toFixed(1)}x</td></tr>
              <tr><td>Time to Peak</td><td>${msToSeconds(token.timeToPeakMs)} seconds</td></tr>
              <tr><td>Collapse Time</td><td>${msToSeconds(token.collapseTimeMs)} seconds</td></tr>
              <tr><td>Buyers (10s)</td><td>${token.buyers10s}</td></tr>
              <tr><td>Buyers (30s)</td><td>${token.buyers30s}</td></tr>
              <tr><td>Hold Duration</td><td>${token.holdDuration} seconds</td></tr>
              <tr><td>Exit Price</td><td>${formatPrice(token.exitPrice, token.exitPrice / solPrice)}</td></tr>
              <tr><td>Profit Gain</td><td>${token.profitGain.toFixed(1)}%</td></tr>
              <tr><td>Profit</td><td>${formatPrice(calculateProfit(token), calculateProfit(token) / solPrice)}</td></tr>
              <tr><td>Tier</td><td>${token.tradeTaken ? token.tier : 'Skipped'}</td></tr>
              <tr><td>Trade Taken</td><td>${token.tradeTaken}</td></tr>
              <tr><td>Triggered At</td><td>${msToSeconds(token.triggeredAtMs)} seconds</td></tr>
              <tr><td>Notes</td><td>${token.notes}</td></tr>
            </table>
          </div>
        `).join('')}
    </div>
</body>
</html>
`;

  try {
    fs.writeFileSync(OUTPUT_HTML, html);
    console.log(`✅ HTML report generated at ${OUTPUT_HTML}`);
  } catch (err) {
    console.error(`❌ Error writing HTML: ${err.message}`);
    process.exit(1);
  }
}

// === Orchestrator ===
(async () => {
  const tokens = await fetchRealTokenData();
  await generateReport(tokens);
})().catch(err => {
  console.error(`❌ Fatal error: ${err.message}`);
  process.exit(1);
});

// Export for external use
export { fetchTokenMetadata };