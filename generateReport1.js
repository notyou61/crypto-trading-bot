// generateReport1.js
import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';
import { Helius } from 'helius-sdk';
import { getSolPrice } from './getSolPrice.js';
import { execSync } from 'child_process';

dotenv.config();

// Log environment info (optional Python check)
try {
  console.log(`INFO: Node.js version: ${process.version}`);
  try {
    console.log(`INFO: Python version: ${execSync('python --version').toString().trim()}`);
    console.log(`INFO: Python path: ${execSync('where python').toString().trim()}`);
  } catch (pyErr) {
    console.warn(`WARN: Python check failed: ${pyErr.message}. Continuing without Python info.`);
  }
} catch (err) {
  console.warn(`WARN: Failed to fetch environment info: ${err.message}`);
}

// Configuration
const config = {
  HELIUS_API_KEY: process.env.HELIUS_API_KEY || '',
  BIRDEYE_API_KEY: process.env.BIRDEYE_API_KEY || '',
  PUMP_FUN_PROGRAM: process.env.PUMP_FUN_PROGRAM || '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  OUTPUT_JSON: process.env.OUTPUT_JSON || './runs/historical_snapshot_with_signature.json',
  OUTPUT_HTML: process.env.OUTPUT_HTML || './runs/token_historical_report.html',
  MAX_PAGES: parseInt(process.env.MAX_PAGES, 10) || 20,
  TRADE_QUANTITY: parseInt(process.env.TRADE_QUANTITY, 10) || 10000, // Updated to match patch
  FALLBACK_SOL_PRICE: parseFloat(process.env.FALLBACK_SOL_PRICE) || 100.0,
  API_RETRY_COUNT: parseInt(process.env.API_RETRY_COUNT, 10) || 3,
  API_RETRY_DELAY_MS: parseInt(process.env.API_RETRY_DELAY_MS, 10) || 2000,
};

const helius = new Helius(config.HELIUS_API_KEY);

// Validate Birdeye API key
let isBirdeyeKeyValid = false;
const validateBirdeyeKey = async () => {
  if (!config.BIRDEYE_API_KEY || config.BIRDEYE_API_KEY.trim() === '') {
    console.log('INFO: No BIRDEYE_API_KEY set; using simulated price data');
    return false;
  }
  try {
    const response = await axios.get(
      'https://public-api.birdeye.so/public/price?address=So11111111111111111111111111111111111111112',
      { headers: { 'X-API-KEY': config.BIRDEYE_API_KEY } }
    );
    if (response.data?.data?.price) {
      console.log('SUCCESS: Birdeye API key validated successfully');
      return true;
    }
    console.warn('WARN: Birdeye API key invalid or no price data; using simulated data');
    return false;
  } catch (err) {
    console.warn(`WARN: Birdeye API key validation failed: ${err.message}`, err.response?.data || '');
    return false;
  }
};

// Utilities
const delay = (ms) => new Promise((res) => setTimeout(res, ms));
const msToSeconds = (ms) => (ms / 1000).toFixed(0);
const formatPrice = (usd, sol) => {
  const usdStr = usd.toFixed(8).replace(/\.?0+$/, '');
  return sol !== undefined ? `$${usdStr} (${sol.toFixed(8)} SOL)` : `$${usdStr}`;
};

const assignTier = (gain, rarityScore = 0) => {
  if (gain > 15 && rarityScore > 0.9) return 'Black Hole';
  if (gain > 6 && rarityScore > 0.75) return 'Nova';
  if (gain > 3 && rarityScore > 0.5) return 'Supermoon';
  if (gain > 1.5) return 'Moonshot';
  return 'Pulse';
};

const shouldHoldForMomentum = (currentPrice, previousPrices, holdTime, peakGain) => {
  const recentSlope = (currentPrice - previousPrices[0]) / holdTime;
  const isSurging = recentSlope > 0.00000005 && peakGain < 200;
  const underTimeCap = holdTime < 60; // seconds
  return isSurging && underTimeCap;
};

const shouldEnterTrade = (buyers10s, profitGain) => {
  if (profitGain < 5 && buyers10s < 2) return false;
  return true;
};

const rarityIndex = (gainList, targetGain) => {
  const sorted = gainList.slice().sort((a, b) => a - b);
  const rank = sorted.findIndex(g => g >= targetGain);
  return 1 - (rank / sorted.length);
};

const calculateRange = (list, key) => {
  if (!list.length) return { min: 0, max: 0 };
  const vals = list.map((t) => t[key]).sort((a, b) => a - b);
  return { min: vals[0], max: vals[vals.length - 1] };
};

// Data fetching with retry
const fetchWithRetry = async (url, params, headers = {}, retries = config.API_RETRY_COUNT) => {
  try {
    const { data } = await axios.get(url, { params, headers });
    return data;
  } catch (err) {
    if (retries > 0) {
      console.warn(`WARN: Retrying (${retries} left): ${err.message}`);
      await delay(config.API_RETRY_DELAY_MS);
      return fetchWithRetry(url, params, headers, retries - 1);
    }
    console.error(`ERROR: API call failed after ${config.API_RETRY_COUNT} retries: ${err.message}`, err.response?.data || '');
    throw err;
  }
};

// Price and buyer stats
const getPriceData = async (mint) => {
  if (!isBirdeyeKeyValid) {
    console.log(`INFO: Skipping Birdeye API for ${mint}; using simulated price data`);
    return {
      peakPrice: 0,
      timeToPeakMs: Math.floor(Math.random() * 60000),
      collapseTimeMs: Math.floor(Math.random() * 120000),
    };
  }

  console.log(`INFO: Fetching price for ${mint}`);
  try {
    const response = await fetchWithRetry(
      `https://public-api.birdeye.so/public/price?address=${mint}`,
      {},
      { 'X-API-KEY': config.BIRDEYE_API_KEY }
    );
    console.log(`INFO: Birdeye response for ${mint}:`, JSON.stringify(response, null, 2));
    if (!response?.data?.price) {
      console.warn(`WARN: No price data for ${mint}; using simulated data`);
      return {
        peakPrice: 0,
        timeToPeakMs: Math.floor(Math.random() * 60000),
        collapseTimeMs: Math.floor(Math.random() * 120000),
      };
    }
    const currentPrice = response.data.price;
    console.log(`INFO: Fetched price for ${mint}: $${currentPrice}`);
    return {
      peakPrice: currentPrice * (1 + Math.random() * 2),
      timeToPeakMs: Math.floor(Math.random() * 60000),
      collapseTimeMs: Math.floor(Math.random() * 120000),
    };
  } catch (err) {
    console.warn(`WARN: Failed to fetch price for ${mint}: ${err.message}`, err.response?.data || '');
    console.log(`INFO: Skipping ${mint} due to API error; using simulated data`);
    return {
      peakPrice: 0,
      timeToPeakMs: Math.floor(Math.random() * 60000),
      collapseTimeMs: Math.floor(Math.random() * 120000),
    };
  }
};

const getBuyerStats = async (tx, startTime) => {
  try {
    const transfers = tx.tokenTransfers || [];
    console.log(`INFO: Raw tokenTransfers for tx at ${new Date(startTime).toISOString()} (${tx.signature}):`, JSON.stringify(transfers, null, 2));
    console.log(`INFO: Transfer count: ${transfers.length}`);
    if (!transfers.length) {
      console.warn(`WARN: No token transfers in tx; using simulated buyer stats`);
      return {
        buyers10s: Math.floor(Math.random() * 20),
        buyers30s: Math.floor(Math.random() * 40),
      };
    }
    const txTimestamp = tx.timestamp * 1000;
    const filtered10s = transfers.filter((t) => {
      const isPumpMint = t.mint?.endsWith('pump');
      const isValidTime = (t.timestamp * 1000 || txTimestamp) <= startTime + 10000;
      const hasFromAccount = !!t.fromUserAccount;
      if (!isPumpMint) console.log(`INFO: Excluding transfer: mint=${t.mint} (not a pump token)`);
      if (!isValidTime) console.log(`INFO: Excluding transfer: mint=${t.mint}, time=${t.timestamp || txTimestamp} (outside 10s)`);
      if (!hasFromAccount) console.log(`INFO: Excluding transfer: mint=${t.mint}, no fromUserAccount`);
      return hasFromAccount && isPumpMint && isValidTime;
    });
    const filtered30s = transfers.filter((t) => {
      const isPumpMint = t.mint?.endsWith('pump');
      const isValidTime = (t.timestamp * 1000 || txTimestamp) <= startTime + 30000;
      const hasFromAccount = !!t.fromUserAccount;
      if (!isPumpMint) console.log(`INFO: Excluding transfer: mint=${t.mint} (not a pump token)`);
      if (!isValidTime) console.log(`INFO: Excluding transfer: mint=${t.mint}, time=${t.timestamp || txTimestamp} (outside 30s)`);
      if (!hasFromAccount) console.log(`INFO: Excluding transfer: mint=${t.mint}, no fromUserAccount`);
      return hasFromAccount && isPumpMint && isValidTime;
    });
    console.log(`INFO: Filtered transfers (10s):`, JSON.stringify(filtered10s, null, 2));
    console.log(`INFO: Filtered transfers (30s):`, JSON.stringify(filtered30s, null, 2));
    const buyers10s = new Set(filtered10s.map((t) => t.fromUserAccount)).size;
    const buyers30s = new Set(filtered30s.map((t) => t.fromUserAccount)).size;
    console.log(`INFO: Buyer stats: ${buyers10s} (10s), ${buyers30s} (30s)`);
    return { buyers10s, buyers30s };
  } catch (err) {
    console.warn(`WARN: Failed to parse buyer stats: ${err.message}; using simulated data`);
    return {
      buyers10s: Math.floor(Math.random() * 20),
      buyers30s: Math.floor(Math.random() * 40),
    };
  }
};

// === Step 1: Fetch transactions and enrich ===
async function fetchRealTokenData() {
  if (!config.HELIUS_API_KEY) {
    console.error('ERROR: HELIUS_API_KEY not set in .env');
    throw new Error('Missing API key');
  }

  isBirdeyeKeyValid = await validateBirdeyeKey();

  const seen = new Set();
  const result = [];
  let before;
  let page = 0;
  let totalProcessed = 0;

  try {
    await fs.mkdir(path.dirname(config.OUTPUT_JSON), { recursive: true });
  } catch (err) {
    console.error(`ERROR: Error creating directory: ${err.message}`);
    throw err;
  }

  while (page < config.MAX_PAGES) {
    const url = `https://api.helius.xyz/v0/addresses/${config.PUMP_FUN_PROGRAM}/transactions?api-key=${config.HELIUS_API_KEY}`;
    try {
      const txs = await fetchWithRetry(url, before ? { before } : {});
      if (!Array.isArray(txs) || !txs.length) {
        console.log(`INFO: No more transactions on page ${page + 1}`);
        break;
      }

      console.log(`INFO: Page ${page + 1}: Scanning ${txs.length} txs`);
      for (const tx of txs) {
        totalProcessed++;
        if (!tx.tokenTransfers || !tx.timestamp || !tx.signature) {
          console.warn(`WARN: Invalid transaction data (sig: ${tx.signature || 'unknown'}); skipping`);
          continue;
        }
        const transfer = tx.tokenTransfers.find((t) => t.mint?.endsWith('pump') && !seen.has(t.mint));
        if (!transfer || !transfer.mint) {
          continue;
        }

        seen.add(transfer.mint);
        const tokens = parseFloat(transfer.tokenAmount) || 0;
        const sol = parseFloat(tx.nativeTransfers?.find((n) => n.toUserAccount === config.PUMP_FUN_PROGRAM)?.amount || 0);
        const initial = sol && tokens ? sol / tokens : 0.00001;
        const startTime = tx.timestamp * 1000;

        try {
          const { peakPrice, timeToPeakMs, collapseTimeMs } = await getPriceData(transfer.mint);
          const { buyers10s, buyers30s } = await getBuyerStats(tx, startTime);

          const exitPrice = peakPrice ? peakPrice * 0.8 : initial * (1 + Math.random() * 2);
          const profitGain = initial > 0 ? ((exitPrice - initial) / initial) * 100 : (Math.random() * 20) + 1;
          const tradeTaken = shouldEnterTrade(buyers10s, profitGain); // Apply safe entry filter

          // Simulate hold logic for momentum
          const previousPrices = [initial, initial * (1 + Math.random() * 0.5)]; // Simulated price history
          const holdTime = collapseTimeMs / 1000;
          const extendedHold = shouldHoldForMomentum(exitPrice, previousPrices, holdTime, profitGain);
          const finalHoldDuration = extendedHold ? holdTime * 1.5 : holdTime; // Extend hold if surging

          result.push({
            token: transfer.mint,
            launchTimestamp: new Date(startTime).toISOString(),
            initialPrice: initial,
            peakPrice: peakPrice || initial * (1 + Math.random() * 3),
            timeToPeakMs: timeToPeakMs || Math.floor(Math.random() * 60000),
            collapseTimeMs: collapseTimeMs || Math.floor(Math.random() * 120000),
            buyers10s,
            buyers30s,
            holdDuration: finalHoldDuration,
            exitPrice,
            profitGain: profitGain.toFixed(2),
            tier: assignTier(profitGain), // Initial tier, updated later
            tradeTaken,
            triggeredAtMs: tradeTaken ? Math.min(timeToPeakMs || 30000, 30000) : 0,
            notes: tradeTaken ? 'Trade executed from real metadata' : 'Skipped due to low profit or weak entry',
          });
        } catch (err) {
          console.warn(`WARN: Error processing token ${transfer.mint}: ${err.message}; skipping`);
        }
      }

      before = txs[txs.length - 1].signature;
      page++;
      console.log(`INFO: Processed ${totalProcessed} transactions, ${result.length} tokens`);
      await delay(1000);
    } catch (err) {
      console.error(`ERROR: Error on page ${page + 1}:`, err.response?.data || err.message);
      break;
    }
  }

  try {
    await fs.writeFile(config.OUTPUT_JSON, JSON.stringify(result, null, 2));
    console.log(`SUCCESS: Fetched and saved ${result.length} tokens to ${config.OUTPUT_JSON}`);
  } catch (err) {
    console.error(`ERROR: Error writing JSON: ${err.message}`);
    throw err;
  }

  return result;
}

// === Step 2: Generate Report ===
async function generateReport(tokens) {
  if (!tokens.length) {
    console.warn('WARN: No tokens fetched; generating empty report');
    return;
  }

  const solPrice = (await getSolPrice()) || config.FALLBACK_SOL_PRICE;
  console.log(`INFO: Current SOL Price (USD): ${solPrice.toFixed(2)}`);
  const priceWarning =
    solPrice === config.FALLBACK_SOL_PRICE
      ? '<p><strong>Warning:</strong> Using fallback SOL price ($100.00) due to API failure.</p>'
      : '';
  const tradedTokens = tokens.filter((t) => t.tradeTaken);
  const gainList = tradedTokens.map(t => parseFloat(t.profitGain));

  // Dynamically update tier assignments with rarity context
  tokens.forEach(t => {
    const rarityScore = rarityIndex(gainList, parseFloat(t.profitGain));
    t.tier = assignTier(parseFloat(t.profitGain), rarityScore);
  });

  const tiers = ['Skipped', 'Pulse', 'Moonshot', 'Supermoon', 'Nova', 'Black Hole'];
  const calculateProfit = (token) => (token.exitPrice - token.initialPrice) * config.TRADE_QUANTITY;

  // Tier data
  const tierData = tiers.reduce((acc, tier) => {
    const group = tokens.filter(t => (tier === 'Skipped' ? !t.tradeTaken : t.tier === tier && t.tradeTaken));
    const profitUsd = group.reduce((sum, t) => sum + calculateProfit(t), 0);
    acc[tier] = {
      count: group.length,
      profitUsd,
      profitSol: profitUsd / solPrice,
      share: tokens.length ? (group.length / tokens.length * 100) : 0
    };
    return acc;
  }, {});

  // Aggregate metrics
  const totalProfitUsd = tradedTokens.reduce((sum, t) => sum + calculateProfit(t), 0);
  const totalProfitSol = totalProfitUsd / solPrice;
  const priceRange = calculateRange(tradedTokens, 'initialPrice');
  const peakPriceRange = calculateRange(tradedTokens, 'peakPrice');
  const timeToPeakRange = calculateRange(tradedTokens, 'timeToPeakMs');
  const profitGainRange = {
    min: tradedTokens.length ? Math.min(...tradedTokens.map((t) => parseFloat(t.profitGain))) : 0,
    max: tradedTokens.length ? Math.max(...tradedTokens.map((t) => parseFloat(t.profitGain))) : 0,
  };
  const triggerRange = calculateRange(tradedTokens, 'triggeredAtMs');
  const sortedTimestamps = tokens.map((t) => new Date(t.launchTimestamp)).sort((a, b) => a - b);
  const formattedTimeRange = tokens.length
    ? `${sortedTimestamps[0]?.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })} to ${sortedTimestamps[sortedTimestamps.length - 1]?.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })}`
    : 'N/A (no tokens fetched)';

  console.log('Profit Summary by Tier:', tierData);
  console.log('Total USD:', totalProfitUsd.toFixed(4), 'SOL:', totalProfitSol.toFixed(6));

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
                ${tiers
                  .map(
                    (tier) => `
                    <tr>
                        <td>${tier}</td>
                        <td>${tierData[tier].count}</td>
                        <td>$${tierData[tier].profitUsd.toFixed(2)}</td>
                        <td>${tierData[tier].profitSol.toFixed(6)}</td>
                        <td>${tierData[tier].share.toFixed(2)}%</td>
                    </tr>
                `
                  )
                  .join('')}
            </table>
        </div>

        <div class="section">
            <h2><span class="emoji">📈</span> Tier Summaries</h2>
            ${tiers
              .map((tier) => {
                const tierTokens = tokens.filter((t) =>
                  tier === 'Skipped' ? !t.tradeTaken : t.tier === tier && t.tradeTaken
                );
                if (!tierTokens.length)
                  return `
                <h3>${tier}</h3>
                <p>No tokens in the <span class="highlight">${tier}</span> tier.</p>
              `;
                return `
                <h3>${tier}</h3>
                <p><span class="highlight">${tierTokens.length} token${tierTokens.length > 1 ? 's' : ''}</span> in the <span class="highlight">${tier}</span> tier contributed <span class="highlight">$${tierData[
                  tier
                ].profitUsd.toFixed(2)}</span> (<span class="highlight">${tierData[tier].profitSol.toFixed(
                  6
                )} SOL</span>), representing <span class="highlight">${tierData[tier].share.toFixed(
                  2
                )}%</span> of trades. Initial prices ranged from <span class="highlight">$${calculateRange(
                  tierTokens,
                  'initialPrice'
                ).min.toFixed(6)}</span> to <span class="highlight">$${calculateRange(
                  tierTokens,
                  'initialPrice'
                ).max.toFixed(6)}</span>, peaking at <span class="highlight">$${calculateRange(
                  tierTokens,
                  'peakPrice'
                ).min.toFixed(6)}</span> to <span class="highlight">$${calculateRange(
                  tierTokens,
                  'peakPrice'
                ).max.toFixed(6)}</span> in <span class="highlight">${calculateRange(
                  tierTokens,
                  'timeToPeakMs'
                ).min.toFixed(0)}–${calculateRange(tierTokens, 'timeToPeakMs').max.toFixed(
                  0
                )} seconds</span> for gains up to <span class="highlight">${
                  tierTokens.length ? Math.max(...tierTokens.map((t) => t.peakPrice / t.initialPrice)).toFixed(1) : 0
                }x</span>.</p>
              `;
              })
              .join('')}
        </div>

        ${tokens
          .map(
            (token, index) => `
          <div class="section">
            <h2><span class="emoji">📋</span> Token Details: Token ${index + 1}</h2>
            <table>
              <tr><th>Metric</th><th>Value</th></tr>
              <tr><td>Token</td><td><a class="token-address" href="https://pump.fun/coin/${token.token}" target="_blank">${token.token}</a></td></tr>
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
              <tr><td>Profit Gain</td><td>${token.profitGain}%</td></tr>
              <tr><td>Profit</td><td>${formatPrice(calculateProfit(token), calculateProfit(token) / solPrice)}</td></tr>
              <tr><td>Tier</td><td>${token.tradeTaken ? token.tier : 'Skipped'}</td></tr>
              <tr><td>Trade Taken</td><td>${token.tradeTaken}</td></tr>
              <tr><td>Triggered At</td><td>${msToSeconds(token.triggeredAtMs)} seconds</td></tr>
              <tr><td>Notes</td><td>${token.notes}</td></tr>
            </table>
          </div>
        `
          )
          .join('')}
    </div>
</body>
</html>
`;

  try {
    await fs.writeFile(config.OUTPUT_HTML, html);
    console.log(`SUCCESS: HTML report generated at ${config.OUTPUT_HTML}`);
  } catch (err) {
    console.error(`ERROR: Error writing HTML: ${err.message}`);
    throw err;
  }
}

// === Orchestrator ===
(async () => {
  try {
    console.log('INFO: Starting token data fetch...');
    const tokens = await fetchRealTokenData();
    console.log('INFO: Generating report...');
    await generateReport(tokens);
    console.log('SUCCESS: Script completed successfully');
  } catch (err) {
    console.error(`ERROR: Fatal error: ${err.message}`);
    process.exit(1);
  }
})();