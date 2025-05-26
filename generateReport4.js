// generateReport4.js
import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';
import { Helius } from 'helius-sdk';
import { getSolPrice } from './getSolPrice.js';

dotenv.config();

// Configuration
const config = {
  HELIUS_API_KEY: process.env.HELIUS_API_KEY || '',
  PUMP_FUN_PROGRAM: process.env.PUMP_FUN_PROGRAM || '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  OUTPUT_JSON: process.env.OUTPUT_JSON || './runs/historical_snapshot_with_signature.json',
  OUTPUT_HTML: process.env.OUTPUT_HTML || './runs/token_historical_report.html',
  MAX_PAGES: parseInt(process.env.MAX_PAGES, 10) || 20,
  TRADE_QUANTITY: parseInt(process.env.TRADE_QUANTITY, 10) || 1000,
  FALLBACK_SOL_PRICE: parseFloat(process.env.FALLBACK_SOL_PRICE) || 100.0,
  API_RETRY_COUNT: parseInt(process.env.API_RETRY_COUNT, 10) || 3,
  API_RETRY_DELAY_MS: parseInt(process.env.API_RETRY_DELAY_MS, 10) || 2000,
};

const helius = new Helius(config.HELIUS_API_KEY);

// Helper functions
const formatPrice = (usd, sol) => {
  const usdStr = usd.toFixed(8).replace(/\.?0+$/, '');
  return sol !== undefined ? `$${usdStr} (${sol.toFixed(8)} SOL)` : `$${usdStr}`;
};

const msToSeconds = (ms) => (ms / 1000).toFixed(0);

const calculatePriceRange = (tokens, key) => {
  if (!tokens.length) return { min: 0, max: 0 };
  const prices = tokens.map((t) => t[key]).sort((a, b) => a - b);
  return { min: prices[0], max: prices[prices.length - 1] };
};

const calculateTimeRange = (tokens, key) => {
  if (!tokens.length) return { min: 0, max: 0 };
  const times = tokens.map((t) => t[key] / 1000).sort((a, b) => a - b);
  return { min: times[0], max: times[times.length - 1] };
};

const assignTier = (profitGain) => {
  if (profitGain > 20) return 'Black Hole';
  if (profitGain > 10) return 'Supermoon';
  if (profitGain > 5) return 'Moonshot';
  if (profitGain > 2) return 'Nova';
  return 'Pulse';
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// === Step 1: Fetch historical tokens ===
async function fetchRealTokenData() {
  if (!config.HELIUS_API_KEY) {
    console.error('❌ HELIUS_API_KEY not set in .env');
    throw new Error('Missing API key');
  }

  const seenMints = new Set();
  const resultList = [];
  let before = undefined;
  let page = 0;

  try {
    await fs.mkdir(path.dirname(config.OUTPUT_JSON), { recursive: true });
  } catch (err) {
    console.error(`❌ Error creating directory: ${err.message}`);
    throw err;
  }

  const fetchWithRetry = async (url, params, retries = config.API_RETRY_COUNT) => {
    try {
      const response = await axios.get(url, { params });
      return response.data;
    } catch (err) {
      if (retries > 0) {
        console.warn(`⚠️ Retrying API call (${retries} attempts left): ${err.message}`);
        await delay(config.API_RETRY_DELAY_MS);
        return fetchWithRetry(url, params, retries - 1);
      }
      throw err;
    }
  };

  const getPriceData = async (mint, startTime) => {
    // TODO: Replace with actual Helius API endpoint or SDK method for price history
    try {
      const url = `https://api.helius.xyz/v0/tokens/${mint}/price?api-key=${config.HELIUS_API_KEY}`;
      const response = await fetchWithRetry(url, { startTime: Math.floor(startTime / 1000) });
      const priceData = response.prices || [];
      if (!priceData.length) return { peakPrice: 0, timeToPeakMs: 0, collapseTimeMs: 0 };

      const prices = priceData.map((p) => p.price);
      const peakPrice = Math.max(...prices);
      const peakIndex = prices.indexOf(peakPrice);
      const timeToPeakMs = (priceData[peakIndex].timestamp - startTime / 1000) * 1000;
      const collapseTimeMs = priceData.length > peakIndex + 1 ? (priceData[priceData.length - 1].timestamp - priceData[peakIndex].timestamp) * 1000 : 0;

      return { peakPrice, timeToPeakMs, collapseTimeMs };
    } catch (err) {
      console.warn(`⚠️ Failed to fetch price data for ${mint}: ${err.message}`);
      return { peakPrice: 0, timeToPeakMs: 0, collapseTimeMs: 0 };
    }
  };

  const getBuyerStats = async (mint, startTime) => {
    // TODO: Replace with actual Helius API endpoint or SDK method for buyer activity
    try {
      const url = `https://api.helius.xyz/v0/tokens/${mint}/activity?api-key=${config.HELIUS_API_KEY}`;
      const response = await fetchWithRetry(url, { startTime: Math.floor(startTime / 1000), endTime: Math.floor(startTime / 1000) + 30 });
      const activities = response.activities || [];
      const buyers10s = activities.filter((a) => a.timestamp <= startTime / 1000 + 10 && a.type === 'buy').length;
      const buyers30s = activities.filter((a) => a.timestamp <= startTime / 1000 + 30 && a.type === 'buy').length;
      return { buyers10s, buyers30s };
    } catch (err) {
      console.warn(`⚠️ Failed to fetch buyer stats for ${mint}: ${err.message}`);
      return { buyers10s: 0, buyers30s: 0 };
    }
  };

  while (page < config.MAX_PAGES) {
    const url = `https://api.helius.xyz/v0/addresses/${config.PUMP_FUN_PROGRAM}/transactions?api-key=${config.HELIUS_API_KEY}`;
    const params = before ? { before } : {};

    try {
      const txs = await fetchWithRetry(url, params);

      if (!Array.isArray(txs) || txs.length === 0) {
        console.log(`ℹ️ No more transactions on page ${page + 1}`);
        break;
      }

      console.log(`📄 Page ${page + 1}: Scanning ${txs.length} txs`);
      for (const tx of txs) {
        const transfer = tx.tokenTransfers?.find(
          (t) => t.mint?.endsWith('pump') && !seenMints.has(t.mint)
        );
        if (!transfer) continue;

        seenMints.add(transfer.mint);

        const tokensReceived = parseFloat(transfer.tokenAmount);
        const solSent = parseFloat(
          tx.nativeTransfers?.find((n) => n.toUserAccount?.endsWith('pump'))?.amount || 0
        );
        const initialPrice = solSent && tokensReceived ? solSent / tokensReceived : 0.00001;
        const startTime = tx.timestamp * 1000;

        // Fetch real price data and buyer stats
        const { peakPrice, timeToPeakMs, collapseTimeMs } = await getPriceData(transfer.mint, startTime);
        const { buyers10s, buyers30s } = await getBuyerStats(transfer.mint, startTime);

        const exitPrice = peakPrice * 0.8 || initialPrice * 1.05; // Exit at 80% of peak or 5% gain
        const profitGain = initialPrice > 0 ? ((exitPrice - initialPrice) / initialPrice) * 100 : 0;
        const tradeTaken = profitGain > 1; // Trade if profit gain > 1%
        const holdDuration = collapseTimeMs || 120000; // Default to 120s

        resultList.push({
          token: transfer.mint,
          launchTimestamp: new Date(tx.timestamp * 1000).toISOString(),
          initialPrice,
          peakPrice: peakPrice || initialPrice * 1.1, // Fallback
          timeToPeakMs: timeToPeakMs || 60000, // Fallback to 60s
          collapseTimeMs: collapseTimeMs || 120000, // Fallback to 120s
          buyers10s: buyers10s || 0,
          buyers30s: buyers30s || 0,
          holdDuration: holdDuration / 1000, // Convert to seconds
          exitPrice,
          profitGain: profitGain.toFixed(2),
          tier: assignTier(profitGain),
          tradeTaken,
          triggeredAtMs: tradeTaken ? Math.min(timeToPeakMs || 30000, 30000) : 0,
          notes: tradeTaken
            ? 'Trade executed based on real Helius transaction data.'
            : 'Skipped due to insufficient profit potential.',
        });
      }

      before = txs[txs.length - 1].signature;
      page++;
      await delay(1000); // Respect API rate limits
    } catch (err) {
      console.error(`❌ Error on page ${page + 1}:`, err.response?.data || err.message);
      break;
    }
  }

  try {
    await fs.writeFile(config.OUTPUT_JSON, JSON.stringify(resultList, null, 2));
    console.log(`✅ Fetched and saved ${resultList.length} tokens to ${config.OUTPUT_JSON}`);
  } catch (err) {
    console.error(`❌ Error writing JSON: ${err.message}`);
    throw err;
  }

  return resultList;
}

// === Step 2: Generate report ===
async function generateReport(tokens) {
  if (!tokens.length) {
    console.warn('⚠️ No tokens fetched; generating empty report');
  }

  const solPrice = (await getSolPrice()) || config.FALLBACK_SOL_PRICE;
  const priceWarning =
    solPrice === config.FALLBACK_SOL_PRICE
      ? '<p><strong>Warning:</strong> Using fallback SOL price ($100.00) due to API failure.</p>'
      : '';
  const tradedTokens = tokens.filter((t) => t.tradeTaken);
  const tiers = ['Skipped', 'Pulse', 'Moonshot', 'Supermoon', 'Nova', 'Black Hole'];

  const calculateProfit = (token) => (token.exitPrice - token.initialPrice) * config.TRADE_QUANTITY;

  // Tier data
  const tierData = tiers.reduce((acc, tier) => {
    const group = tokens.filter((t) => (tier === 'Skipped' ? !t.tradeTaken : t.tier === tier && t.tradeTaken));
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
    min: tradedTokens.length ? Math.min(...tradedTokens.map((t) => t.profitGain)) : 0,
    max: tradedTokens.length ? Math.max(...tradedTokens.map((t) => t.profitGain)) : 0,
  };
  const triggerRange = calculateTimeRange(tradedTokens, 'triggeredAtMs');
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
                )}%</span> of trades. Initial prices ranged from <span class="highlight">$${calculatePriceRange(
                  tierTokens,
                  'initialPrice'
                ).min.toFixed(6)}</span> to <span class="highlight">$${calculatePriceRange(
                  tierTokens,
                  'initialPrice'
                ).max.toFixed(6)}</span>, peaking at <span class="highlight">$${calculatePriceRange(
                  tierTokens,
                  'peakPrice'
                ).min.toFixed(6)}</span> to <span class="highlight">$${calculatePriceRange(
                  tierTokens,
                  'peakPrice'
                ).max.toFixed(6)}</span> in <span class="highlight">${calculateTimeRange(
                  tierTokens,
                  'timeToPeakMs'
                ).min.toFixed(0)}–${calculateTimeRange(tierTokens, 'timeToPeakMs').max.toFixed(
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
              <tr><td>Token</td><td><a class="token-address" href="https://pump.fun/coin/${token.token}" target="_blank">Token ${token.token}</a></td></tr>
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
    console.log(`✅ HTML report generated at ${config.OUTPUT_HTML}`);
  } catch (err) {
    console.error(`❌ Error writing HTML: ${err.message}`);
    throw err;
  }
}

// === Orchestrator ===
(async () => {
  try {
    const tokens = await fetchRealTokenData();
    await generateReport(tokens);
  } catch (err) {
    console.error(`❌ Fatal error: ${err.message}`);
    process.exit(1);
  }
})();