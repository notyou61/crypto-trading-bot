// profitabilityReport5.js

import { Connection, PublicKey } from '@solana/web3.js';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import { format } from 'date-fns';
import cliProgress from 'cli-progress';
import { getSolPrice } from './getSOLPrice.js';

dotenv.config();

// Configuration
const config = {
  RPC_ENDPOINT: process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com',
  HELIUS_API_KEY: process.env.HELIUS_API_KEY,
  PUMP_FUN_PROGRAM: process.env.PUMP_FUN_PROGRAM || '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  REPORT_JSON_PATH: './runs/profitability_report.json',
  REPORT_HTML_PATH: './runs/profitability_report.html',
  TRADE_SIZE: 0.05,
  TX_FEE: 0.0001,
  MAX_HOLD_TIME: 120000,
};

// Rate limiter
class RateLimiter {
  constructor(requestsPerSecond) {
    this.interval = 1000 / requestsPerSecond;
    this.lastRequest = 0;
  }

  async wait() {
    const now = Date.now();
    const waitTime = Math.max(0, this.interval - (now - this.lastRequest));
    if (waitTime > 0) await new Promise(resolve => setTimeout(resolve, waitTime));
    this.lastRequest = Date.now();
  }
}

const rpcLimiter = new RateLimiter(2);

// Throttled axios
async function throttledGet(url, options = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      await rpcLimiter.wait();
      const res = await axios.get(url, {
        ...options,
        headers: { 'User-Agent': 'PumpiyoBot/1.0', ...options.headers },
      });
      return res.data;
    } catch (err) {
      if (err.response?.status === 429 && i < retries - 1) {
        const delay = 1000 * (i + 1);
        console.warn(`Server responded with 429. Retrying after ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
}

// Escape HTML
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, char => map[char]);
}

// Initialize connection
let connection;
async function getConnection() {
  try {
    connection = new Connection(config.RPC_ENDPOINT, 'confirmed');
    await rpcLimiter.wait();
    const version = await connection.getVersion();
    console.log(`INFO: Connected to RPC: ${config.RPC_ENDPOINT}, Solana version: ${version['solana-core']}`);
    return connection;
  } catch (err) {
    console.error(`ERROR: Failed to connect to ${config.RPC_ENDPOINT}: ${err.message}`);
    process.exit(1);
  }
}

// Fetch token supply
const supplyCache = new Map();
async function getTokenSupply(mint) {
  if (supplyCache.has(mint)) {
    console.log(`INFO: Using cached supply for ${mint}`);
    return supplyCache.get(mint);
  }
  try {
    await rpcLimiter.wait();
    const mintPubkey = new PublicKey(mint);
    const mintInfo = await connection.getParsedAccountInfo(mintPubkey);
    if (!mintInfo.value) throw new Error(`No mint data for ${mint}`);
    const supply = mintInfo.value.data.parsed.info.supply / 1_000_000;
    supplyCache.set(mint, supply);
    console.log(`INFO: Token ${mint} supply: ${supply} tokens`);
    return supply;
  } catch (err) {
    console.warn(`ERROR: Failed to fetch token supply for ${mint}: ${err.message}`);
    return null;
  }
}

// Fetch vault balance
async function getVaultBalance(vaultAddress) {
  try {
    await rpcLimiter.wait();
    const vaultPubkey = new PublicKey(vaultAddress);
    const balance = await connection.getBalance(vaultPubkey);
    const solBalance = balance / 1_000_000_000;
    console.log(`INFO: Vault ${vaultAddress} balance: ${solBalance} SOL`);
    return solBalance;
  } catch (err) {
    console.warn(`ERROR: Failed to fetch vault balance for ${vaultAddress}: ${err.message}`);
    return null;
  }
}

// Derive vault address
async function getVaultAddress(mint) {
  try {
    const programPubkey = new PublicKey(config.PUMP_FUN_PROGRAM);
    const mintPubkey = new PublicKey(mint);
    const [vaultPda] = await PublicKey.findProgramAddress(
      [Buffer.from('bonding-curve'), mintPubkey.toBuffer()],
      programPubkey
    );
    await rpcLimiter.wait();
    const balance = await connection.getBalance(vaultPda);
    if (balance === 0) throw new Error('Vault has no balance');
    console.log(`INFO: Vault address for ${mint}: ${vaultPda.toString()}`);
    return vaultPda.toString();
  } catch (err) {
    console.warn(`WARN: PDA vault lookup failed for ${mint}: ${err.message}`);
    return null;
  }
}

// Calculate price
function calculatePrice(tokenSupply, solInVault) {
  if (tokenSupply <= 0 || solInVault <= 0) {
    console.warn(`WARN: Invalid inputs for price calculation: tokenSupply=${tokenSupply}, solInVault=${solInVault}`);
    return 0;
  }
  const basePrice = solInVault / tokenSupply;
  const curveFactor = Math.log10(tokenSupply / 1_000_000 + 1) * 1.0;
  const price = basePrice * curveFactor * 1_000_000;
  const finalPrice = isNaN(price) || price < 0.00000001 ? 0.00000001 : price;
  console.log(`DEBUG: Price calc: basePrice=${basePrice}, curveFactor=${curveFactor}, finalPrice=${finalPrice}`);
  return finalPrice;
}

// Fetch buyer stats
async function getBuyerStats(mint, startTime) {
  try {
    const mintPubkey = new PublicKey(mint);
    const buyers10s = new Set();
    const buyers30s = new Set();
    let beforeSignature = null;

    while (true) {
      await rpcLimiter.wait();
      const options = beforeSignature ? { limit: 1000, before: beforeSignature } : { limit: 1000 };
      const signatures = await connection.getSignaturesForAddress(mintPubkey, options);
      if (!signatures.length) break;

      for (const sig of signatures) {
        if (!sig.blockTime) continue;
        const txTime = sig.blockTime * 1000;
        if (txTime > startTime + 30000 || txTime < startTime) continue;

        await rpcLimiter.wait();
        const tx = await connection.getParsedTransaction(sig.signature, { maxSupportedTransactionVersion: 0 });
        if (!tx) continue;

        const tokenTransfers = (tx.meta?.innerInstructions ?? []).flatMap(ii =>
          ii.instructions.filter(i =>
            i.programId.toString() === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' &&
            i.parsed?.type === 'transfer' &&
            i.parsed?.info?.mint === mint
          )
        );

        for (const transfer of tokenTransfers) {
          const to = transfer.parsed?.info?.destination;
          if (!to || to === mint) continue;
          if (txTime <= startTime + 10000) buyers10s.add(to);
          if (txTime <= startTime + 30000) buyers30s.add(to);
        }
      }

      beforeSignature = signatures[signatures.length - 1].signature;
      if (signatures.length < 1000) break;
    }

    console.log(`INFO: Buyer stats for ${mint}: ${buyers10s.size} (10s), ${buyers30s.size} (30s)`);
    return { buyers10s: buyers10s.size, buyers30s: buyers30s.size };
  } catch (err) {
    console.warn(`WARN: Failed to fetch buyer stats for ${mint}: ${err.message}`);
    return { buyers10s: 0, buyers30s: 0 };
  }
}

// Simulate trade
async function simulateTrade(mint, startTime) {
  const solPrice = (await getSolPrice()) || 166.0;
  const vaultAddress = await getVaultAddress(mint);
  if (!vaultAddress) {
    console.warn(`WARN: Skipping ${mint} due to invalid vault address`);
    return { mint, status: 'skipped', reason: 'invalid_vault' };
  }

  let initialPrice = null;
  let tradeExecuted = false;
  let timestamp = 0;
  let tier = 'Flicker';
  const tradeLog = {
    timestamp: format(startTime || new Date(), 'yyyy-MM-dd HH:mm:ss'),
    mint: escapeHtml(mint),
    vaultAddress: escapeHtml(vaultAddress),
    entryPrice: null,
    exitPrice: null,
    profitSol: 0,
    profitUsd: 0,
    status: 'skipped',
    reason: 'insufficient_buyers',
    buyers10s: 0,
    buyers30s: 0,
    durationSec: 0,
    tier,
    chartLink: `https://pump.fun/coin/${mint}`,
  };

  const buyerStats = await getBuyerStats(mint, startTime);
  tradeLog.buyers10s = buyerStats.buyers10s;
  tradeLog.buyers30s = buyerStats.buyers30s;

  if (buyerStats.buyers10s < 1) {
    console.log(`INFO: Skipping trade for ${mint} due to insufficient buyers (${buyerStats.buyers10s}/1)`);
    return tradeLog;
  }

  const simStart = Date.now();
  while (Date.now() - simStart < config.MAX_HOLD_TIME) {
    const tokenSupply = await getTokenSupply(mint);
    const solInVault = await getVaultBalance(vaultAddress);
    if (!tokenSupply || !solInVault) {
      console.warn(`WARN: Skipping ${mint} due to missing data`);
      tradeLog.status = 'failed';
      tradeLog.reason = 'missing_data';
      return tradeLog;
    }

    const currentPrice = calculatePrice(tokenSupply, solInVault);
    console.log(`INFO: Current price for ${mint}: ${currentPrice.toFixed(8)} SOL`);
    if (!initialPrice) initialPrice = currentPrice;

    // Tier classification
    if (currentPrice >= initialPrice * 3.0) tier = 'Moonshot';
    else if (currentPrice >= initialPrice * 1.5) tier = 'Rocket';
    else if (currentPrice >= initialPrice * 1.1) tier = 'Spark';
    tradeLog.tier = tier;

    // Enter trade
    if (!tradeExecuted && currentPrice >= initialPrice * 1.10 && currentPrice >= 0.0000001) {
      tradeExecuted = true;
      tradeLog.entryPrice = currentPrice;
      tradeLog.status = 'entered';
      tradeLog.reason = 'price_threshold_met';
      timestamp = Date.now();
      console.log(`INFO: [Simulated] Buying ${mint} at ${currentPrice.toFixed(8)} SOL`);
    }

    // Exit trade
    if (tradeExecuted && tradeLog.status === 'entered') {
      const heldDuration = Date.now() - timestamp;
      if (currentPrice >= tradeLog.entryPrice * 3.0 && heldDuration >= 60000) {
        tradeLog.exitPrice = currentPrice;
        tradeLog.status = 'moonshot_exit';
        tradeLog.reason = 'moonshot_target_hit';
        tradeLog.durationSec = Math.round(heldDuration / 1000);
        tradeLog.profitSol = (currentPrice - tradeLog.entryPrice) * config.TRADE_SIZE - config.TX_FEE;
        tradeLog.profitUsd = tradeLog.profitSol * solPrice;
        console.log(`✅ Exiting ${mint} at +200% after ${tradeLog.durationSec}s`);
        break;
      } else if (currentPrice >= tradeLog.entryPrice * 1.5 || heldDuration >= 120000) {
        tradeLog.exitPrice = currentPrice;
        tradeLog.status = 'fallback_exit';
        tradeLog.reason = heldDuration >= 120000 ? 'max_hold_time' : 'fallback_target_hit';
        tradeLog.durationSec = Math.round(heldDuration / 1000);
        tradeLog.profitSol = (currentPrice - tradeLog.entryPrice) * config.TRADE_SIZE - config.TX_FEE;
        tradeLog.profitUsd = tradeLog.profitSol * solPrice;
        console.log(`⚠️ Exiting ${mint} at fallback after ${tradeLog.durationSec}s`);
        break;
      }
    }

    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  return tradeLog;
}

// Generate HTML report
async function generateHtmlReport(trades, snowball) {
  const timestamp = format(new Date(), 'yyyyMMdd_HHmmss');
  const htmlPath = config.REPORT_HTML_PATH.replace('.html', `_${timestamp}.html`);
  const tierColors = {
    Moonshot: '#FFD700',
    Rocket: '#FF6347',
    Spark: '#90EE90',
    Flicker: '#D3D3D3',
  };

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Pumpiyo Sniper Bot Profitability Report</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
        .summary { margin-bottom: 20px; }
        a { color: #1e90ff; text-decoration: none; }
        a:hover { text-decoration: underline; }
      </style>
    </head>
    <body>
      <h1>Pumpiyo Sniper Bot Profitability Report</h1>
      <div class="summary">
        <p><strong>Generated:</strong> ${format(new Date(), 'yyyy-MM-dd HH:mm:ss')}</p>
        <p><strong>Total Trades:</strong> ${trades.length}</p>
        <p><strong>Successful Trades:</strong> ${trades.filter(t => t.profitSol > 0).length}</p>
        <p><strong>Total Profit:</strong> ${trades.reduce((sum, t) => sum + t.profitSol, 0).toFixed(4)} SOL</p>
        <p><strong>Snowball Bankroll:</strong> ${snowball.bankroll.toFixed(2)} SOL</p>
        <p><strong>Win Rate:</strong> ${((trades.filter(t => t.profitSol > 0).length / trades.length) * 100 || 0).toFixed(2)}%</p>
        <p><strong>ROI:</strong> ${(trades.reduce((sum, t) => sum + t.profitSol, 0) / (config.TRADE_SIZE * trades.length) * 100 || 0).toFixed(2)}%</p>
        <p><strong>Avg Trade Duration:</strong> ${(trades.reduce((sum, t) => sum + (t.durationSec || 0), 0) / trades.length || 0).toFixed(2)}s</p>
      </div>
      <table>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Token</th>
            <th>Tier</th>
            <th>Status</th>
            <th>Reason</th>
            <th>Entry Price (SOL)</th>
            <th>Exit Price (SOL)</th>
            <th>Profit (SOL)</th>
            <th>Profit (USD)</th>
            <th>Buyers (10s/30s)</th>
            <th>Duration (s)</th>
            <th>Chart</th>
          </tr>
        </thead>
        <tbody>
          ${trades.map(t => `
            <tr style="background-color: ${tierColors[t.tier] || '#FFFFFF'};">
              <td>${escapeHtml(t.timestamp)}</td>
              <td><a href="${t.chartLink}" target="_blank">${escapeHtml(t.mint.slice(0, 8))}...</a></td>
              <td>${escapeHtml(t.tier)}</td>
              <td>${escapeHtml(t.status)}</td>
              <td>${escapeHtml(t.reason)}</td>
              <td>${t.entryPrice?.toFixed(8) || '-'}</td>
              <td>${t.exitPrice?.toFixed(8) || '-'}</td>
              <td>${t.profitSol.toFixed(4)}</td>
              <td>${t.profitUsd.toFixed(2)}</td>
              <td>${t.buyers10s}/${t.buyers30s}</td>
              <td>${t.durationSec.toFixed(2)}</td>
              <td><a href="${t.chartLink}" target="_blank">View</a></td>
            </tr>
          `).join('')}
          <tr style="font-weight: bold;">
            <td colspan="7">Total</td>
            <td>${trades.reduce((sum, t) => sum + t.profitSol, 0).toFixed(4)}</td>
            <td>${trades.reduce((sum, t) => sum + t.profitUsd, 0).toFixed(2)}</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
          </tr>
        </tbody>
      </table>
    </body>
    </html>
  `;
  await fs.mkdir(path.dirname(htmlPath), { recursive: true });
  await fs.writeFile(htmlPath, html);
  console.log(`INFO: HTML report saved to ${htmlPath}`);
  return htmlPath;
}

// Manage snowball
async function manageSnowball(trades) {
  let snowball = {
    bankroll: 0.5,
    tradesExecuted: 0,
    status: 'active',
    target: 5.0,
  };

  for (const trade of trades) {
    if (trade?.profitSol > 0) {
      snowball.bankroll += trade.profitSol;
      snowball.tradesExecuted += 1;
    }
    if (snowball.bankroll >= snowball.target) {
      snowball.status = 'reserve_mode';
      console.log(`INFO: Snowball complete: ${snowball.bankroll.toFixed(2)} SOL`);
      break;
    }
  }

  return snowball;
}

// Generate interim report
async function generateInterimReport(trades, progressBar) {
  const snowball = await manageSnowball(trades);
  await fs.mkdir(path.dirname(config.REPORT_JSON_PATH), { recursive: true });
  await fs.writeFile(config.REPORT_JSON_PATH, JSON.stringify(trades, null, 2));
  const htmlPath = await generateHtmlReport(trades, snowball);
  if (progressBar) {
    progressBar.update({ profit: trades.reduce((sum, t) => sum + t.profitSol, 0).toFixed(4) });
  }
  console.log(`INFO: Interim report generated with ${trades.length} trades at ${htmlPath}`);
}

// Monitor live trades
async function generateProfitabilityReport() {
  console.log('INFO: Starting profitability report generation...');
  connection = await getConnection();
  const url = `https://api.helius.xyz/v0/addresses/${config.PUMP_FUN_PROGRAM}/transactions?api-key=${config.HELIUS_API_KEY}`;
  const seen = new Set();
  let trades = [];
  const analyzedTokens = [];

  const progressBar = new cliProgress.SingleBar({
    format: 'Progress |{bar}| {percentage}% | Tokens: {value}/{total} | Profit: {profit} SOL | ETA: {eta}s',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true,
  });

  const startTime = Date.now();
  const durationMs = 60 * 60 * 1000;
  let lastReportTime = startTime;
  progressBar.start(1000, 0, { profit: '0.0000' });

  while (Date.now() - startTime < durationMs) {
    try {
      const txs = await throttledGet(url);
      console.log(`INFO: Fetched ${txs.length} transactions`);
      for (const tx of txs) {
        const transfer = tx.tokenTransfers?.find(t => t.mint?.endsWith('pump') && !seen.has(t.mint));
        if (!transfer?.mint) continue;

        seen.add(transfer.mint);
        console.log(`INFO: Analyzing token: ${transfer.mint}`);
        analyzedTokens.push({ mint: transfer.mint, timestamp: tx.timestamp });
        const tradeLog = await simulateTrade(transfer.mint, tx.timestamp * 1000);
        if (tradeLog) {
          trades.push(tradeLog);
          console.log(`INFO: Trade log for ${transfer.mint}: ${tradeLog.status}`);
          progressBar.increment();
        }

        if (trades.length >= 5 || Date.now() - lastReportTime >= 5 * 60 * 1000) {
          await generateInterimReport(trades, progressBar);
          await fs.writeFile('./runs/analyzed_tokens.json', JSON.stringify(analyzedTokens, null, 2));
          console.log(`INFO: Saved ${analyzedTokens.length} analyzed tokens`);
          trades = [];
          lastReportTime = Date.now();
        }
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (err) {
      console.error(`ERROR: Failed to fetch transactions: ${err.message}`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  if (trades.length > 0) {
    await generateInterimReport(trades, progressBar);
    await fs.writeFile('./runs/analyzed_tokens.json', JSON.stringify(analyzedTokens, null, 2));
  }

  progressBar.stop();
  console.log('INFO: Report generation complete');
}

// Run
(async () => {
  try {
    await generateProfitabilityReport();
  } catch (err) {
    console.error(`ERROR: Fatal error: ${err.message}`);
    process.exit(1);
  }
})();