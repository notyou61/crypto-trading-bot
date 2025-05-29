// profitabilityReport1.js
import { Connection, PublicKey } from '@solana/web3.js';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import { format } from 'date-fns';
import nodemailer from 'nodemailer';

import archiver from 'archiver';
import { getSolPrice } from './getSOLPrice.js';

dotenv.config();

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
  const map = new Map([
    ['&', '&amp;'],
    ['<', '&lt;'],
    ['>', '&gt;'],
    ['"', '&quot;'],
    ["'", '&#039;'],
  ]);
  return text.replace(/[&<>"']/g, char => map.get(char));
}

// Configuration
const config = {
  RPC_ENDPOINTS: [
    process.env.RPC_ENDPOINT_1 || 'https://mainnet.helius-rpc.com/?api-key=82256758-538e-4d1a-a827-39d8a176c540',
    process.env.RPC_ENDPOINT_3 || 'https://chaotic-rough-gadget.solana-mainnet.quiknode.pro/b96d9392b154ac9decb744e59a4274d3dde0d8fc',
  ],
  HELIUS_API_KEY: process.env.HELIUS_API_KEY || '82256758-538e-4d1a-a827-39d8a176c540',
  PUMP_FUN_PROGRAM: process.env.PUMP_FUN_PROGRAM || '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  REPORT_JSON_PATH: process.env.REPORT_JSON_PATH || './runs/profitability_report.json',
  REPORT_HTML_PATH: process.env.REPORT_HTML_PATH || './runs/profitability_report.html',
  REPORT_PDF_PATH: process.env.REPORT_PDF_PATH || './runs/profitability_report.pdf',
  FALLBACK_SOL_PRICE: parseFloat(process.env.FALLBACK_SOL_PRICE) || 166.0,
  TRADE_SIZE: parseFloat(process.env.TRADE_SIZE) || 0.05,
  SLIPPAGE: parseFloat(process.env.SLIPPAGE) || 0.03,
  TX_FEE: parseFloat(process.env.TX_FEE) || 0.0001,
  MAX_HOLD_TIME: parseInt(process.env.MAX_HOLD_TIME) || 120000,
  EMAIL_HOST: process.env.SMTP_HOST || 'smtp.gmail.com',
  EMAIL_PORT: parseInt(process.env.SMTP_PORT) || 587,
  EMAIL_USER: process.env.REPORT_EMAIL_ADDRESS || 'steve.skye.skyelighting@gmail.com',
  EMAIL_PASS: process.env.REPORT_EMAIL_PASSWORD || 'zjsshnmlvrdbwxsl',
  EMAIL_TO: process.env.REPORT_EMAIL_RECIPIENT || 'steve.skye@skyelighting.com',
};

// Validate .env
const requiredVars = ['HELIUS_API_KEY', 'REPORT_JSON_PATH', 'REPORT_HTML_PATH', 'REPORT_EMAIL_ADDRESS', 'REPORT_EMAIL_PASSWORD', 'REPORT_EMAIL_RECIPIENT'];
const missingVars = requiredVars.filter(v => !process.env[v]);
if (missingVars.length > 0) {
  console.error(`ERROR: Missing environment variables: ${missingVars.join(', ')}`);
  process.exit(1);
}

// Initialize connection
let connection;
let currentRpcIndex = 0;
async function getConnection() {
  for (let i = 0; i < config.RPC_ENDPOINTS.length; i++) {
    const endpoint = config.RPC_ENDPOINTS[(currentRpcIndex + i) % config.RPC_ENDPOINTS.length];
    try {
      connection = new Connection(endpoint, 'confirmed');
      await rpcLimiter.wait();
      const version = await connection.getVersion();
      console.log(`INFO: Connected to RPC: ${endpoint}, Solana version: ${version['solana-core']}`);
      currentRpcIndex = (currentRpcIndex + i) % config.RPC_ENDPOINTS.length;
      return connection;
    } catch (err) {
      console.warn(`ERROR: Failed to connect to ${endpoint}: ${err.message}`);
    }
  }
  console.error('ERROR: All RPC endpoints failed');
  process.exit(1);
}

// Fetch token supply
const supplyCache = new Map();
async function getTokenSupply(mintAddress) {
  if (supplyCache.has(mintAddress)) {
    console.log(`INFO: Using cached supply for ${mintAddress}`);
    return supplyCache.get(mintAddress);
  }
  try {
    await rpcLimiter.wait();
    const mintPubkey = new PublicKey(mintAddress);
    const mintInfo = await connection.getParsedAccountInfo(mintPubkey);
    if (!mintInfo.value) throw new Error(`No mint data for ${mintAddress}`);
    const supply = mintInfo.value.data.parsed.info.supply / 1_000_000;
    supplyCache.set(mintAddress, supply);
    console.log(`INFO: Token ${mintAddress} supply: ${supply} tokens`);
    return supply;
  } catch (err) {
    console.warn(`ERROR: Failed to fetch token supply for ${mintAddress}: ${err.message}`);
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
async function getVaultAddress(mintAddress) {
  try {
    const programPubkey = new PublicKey(config.PUMP_FUN_PROGRAM);
    const mintPubkey = new PublicKey(mintAddress);
    const [vaultPda] = await PublicKey.findProgramAddress(
      [Buffer.from('bonding-curve'), mintPubkey.toBuffer()],
      programPubkey
    );
    await rpcLimiter.wait();
    const balance = await connection.getBalance(vaultPda);
    if (balance === 0) throw new Error('Vault has no balance');
    console.log(`INFO: Vault address for ${mintAddress}: ${vaultPda.toString()}`);
    return vaultPda.toString();
  } catch (err) {
    console.warn(`WARN: PDA vault lookup failed for ${mintAddress}: ${err.message}`);
    try {
      await rpcLimiter.wait();
      const signatures = await connection.getSignaturesForAddress(new PublicKey(mintAddress), { limit: 1 });
      if (!signatures.length) throw new Error('No creation transaction found');
      await rpcLimiter.wait();
      const tx = await connection.getParsedTransaction(signatures[0].signature, { maxSupportedTransactionVersion: 0 });
      const vaultAccount = tx.transaction.message.accountKeys.find(
        key => key.writable && key.pubkey.toString() !== mintAddress
      );
      if (!vaultAccount) throw new Error('No vault account in transaction');
      console.log(`INFO: Fallback vault address for ${mintAddress}: ${vaultAccount.pubkey.toString()}`);
      return vaultAccount.pubkey.toString();
    } catch (fallbackErr) {
      console.warn(`ERROR: Fallback vault lookup failed for ${mintAddress}: ${fallbackErr.message}`);
      return null;
    }
  }
}

// 📈 calculatePrice.js
export function calculatePrice(tokenSupply, solInVault) {
  if (tokenSupply <= 0 || solInVault <= 0) {
    console.warn(`WARN: Invalid inputs for price calculation: tokenSupply=${tokenSupply}, solInVault=${solInVault}`);
    return 0;
  }

  const basePrice = solInVault / tokenSupply; // SOL per token
  const curveFactor = Math.log10(tokenSupply / 1_000_000 + 1) * 1.0;
  const price = basePrice * curveFactor * 1_000_000; // Scaled to avoid underflow

  const finalPrice = isNaN(price) || price < 0.00000001 ? 0.00000001 : price;
  console.log(`DEBUG: Price calc: basePrice=${basePrice}, curveFactor=${curveFactor}, finalPrice=${finalPrice}`);
  return finalPrice;
}
// Fetch buyer stats with pagination
async function getBuyerStats(mintAddress, startTime) {
  try {
    const mintPubkey = new PublicKey(mintAddress);
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
        if (txTime > startTime + 30000) continue;
        if (txTime < startTime) return summarize();

        await rpcLimiter.wait();
        const tx = await connection.getParsedTransaction(sig.signature, { maxSupportedTransactionVersion: 0 });
        if (!tx) continue;

        const tokenTransfers = (tx.meta?.innerInstructions ?? []).flatMap(ii =>
          ii.instructions.filter(i =>
            i.programId.toString() === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' &&
            i.parsed?.type === 'transfer' &&
            i.parsed?.info?.mint === mintAddress
          )
        );

        for (const transfer of tokenTransfers) {
          const to = transfer.parsed?.info?.destination;
          if (!to || to === mintAddress) continue;

          if (txTime <= startTime + 10000) buyers10s.add(to);
          if (txTime <= startTime + 30000) buyers30s.add(to);
        }
      }

      beforeSignature = signatures[signatures.length - 1].signature;
      if (signatures.length < 1000) break;
    }

    return summarize();

    function summarize() {
      console.log(`INFO: Buyer stats for ${mintAddress}: ${buyers10s.size} (10s), ${buyers30s.size} (30s)`);
      return { buyers10s: buyers10s.size, buyers30s: buyers30s.size };
    }

  } catch (err) {
    console.warn(`WARN: Failed to fetch buyer stats for ${mintAddress}: ${err.message}`);
    return { buyers10s: 0, buyers30s: 0 };
  }
}

// Simulate trade
async function simulateTrade(mintAddress, startTime) {
  const solPrice = (await getSolPrice()) || config.FALLBACK_SOL_PRICE;
  const vaultAddress = await getVaultAddress(mintAddress);
  if (!vaultAddress) {
    console.warn(`WARN: Skipping ${mintAddress} due to invalid vault address`);
    return null;
  }

  let initialPrice = null;
  let tradeExecuted = false;
  let timestamp = 0; // Declare at top of scope for tracking entry time
  let tradeLog = {
    timestamp: format(startTime || new Date(), 'yyyy-MM-dd HH:mm:ss'),
    mintAddress: escapeHtml(mintAddress),
    vaultAddress: escapeHtml(vaultAddress),
    entryPrice: null,
    exitPrice: null,
    profitSol: 0,
    profitUsd: 0,
    status: 'skipped',
    buyers10s: 0,
    buyers30s: 0,
    duration: 0,
  };

  const buyerStats = await getBuyerStats(mintAddress, startTime);
  tradeLog.buyers10s = buyerStats.buyers10s;
  tradeLog.buyers30s = buyerStats.buyers30s;

  if (buyerStats.buyers10s < 0) { // Temporary: ≥0 for testing
    console.log(`INFO: Skipping trade for ${mintAddress} due to insufficient buyers (${buyerStats.buyers10s}/0)`);
    return tradeLog;
  }

  const simStart = Date.now();
  while (Date.now() - simStart < config.MAX_HOLD_TIME) {
    const tokenSupply = await getTokenSupply(mintAddress);
    const solInVault = await getVaultBalance(vaultAddress);
    if (!tokenSupply || !solInVault) {
      console.warn(`WARN: Skipping ${mintAddress} due to missing data`);
      tradeLog.status = 'failed';
      return tradeLog;
    }

    const currentPrice = calculatePrice(tokenSupply, solInVault);
    console.log(`INFO: Current price for ${mintAddress}: ${currentPrice.toFixed(8)} SOL`);
    if (!initialPrice) initialPrice = currentPrice;

    // Check if we should enter the trade
    if (!tradeExecuted && currentPrice >= initialPrice * 1.10 && currentPrice >= 0.0000001) {
      tradeExecuted = true;
      tradeLog.entryPrice = currentPrice;
      tradeLog.status = 'entered';
      timestamp = Date.now(); // Track entry time
      console.log(`INFO: [Simulated] Buying ${mintAddress} at ${currentPrice.toFixed(8)} SOL`);
    }

    // Simulate trade execution
    if (tradeExecuted && tradeLog.status === 'entered') {
      const heldDuration = Date.now() - timestamp; // in ms

      // Strategy v3 logic
      if (currentPrice >= tradeLog.entryPrice * 3.0 && heldDuration >= 60000) {
        tradeLog.exitPrice = currentPrice;
        tradeLog.status = 'moonshot_exit';
        tradeLog.duration = Math.round(heldDuration / 1000);
        tradeLog.profitSol = currentPrice - tradeLog.entryPrice;
        tradeLog.profitUsd = tradeLog.profitSol * solPrice;
        console.log(`✅ Exiting ${mintAddress} at +200% after ${tradeLog.duration}s`);
        break;
      } else if (
        currentPrice >= tradeLog.entryPrice * 1.5 || // +50%
        heldDuration >= 120000 // or held 120s max
      ) {
        tradeLog.exitPrice = currentPrice;
        tradeLog.status = 'fallback_exit';
        tradeLog.duration = Math.round(heldDuration / 1000);
        tradeLog.profitSol = currentPrice - tradeLog.entryPrice;
        tradeLog.profitUsd = tradeLog.profitSol * solPrice;
        console.log(`⚠️ Exiting ${mintAddress} at fallback after ${tradeLog.duration}s`);
        break;
      }
    }

    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  return tradeLog;
}

// Generate HTML report
async function generateHtmlReport(trades, snowball) {
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
        <p><strong>Avg Trade Duration:</strong> ${(trades.reduce((sum, t) => sum + (t.duration || 0), 0) / trades.length || 0).toFixed(2)}s</p>
      </div>
      <table>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Token</th>
            <th>Status</th>
            <th>Entry Price (SOL)</th>
            <th>Exit Price (SOL)</th>
            <th>Profit (SOL)</th>
            <th>Profit (USD)</th>
            <th>Buyers (10s/30s)</th>
            <th>Duration (s)</th>
          </tr>
        </thead>
        <tbody>
          ${trades.map(t => `
            <tr>
              <td>${escapeHtml(t.timestamp)}</td>
              <td>${escapeHtml(t.mintAddress)}</td>
              <td>${escapeHtml(t.status)}</td>
              <td>${t.entryPrice?.toFixed(8) || '-'}</td>
              <td>${t.exitPrice?.toFixed(8) || '-'}</td>
              <td>${t.profitSol.toFixed(4)}</td>
              <td>${t.profitUsd.toFixed(2)}</td>
              <td>${t.buyers10s}/${t.buyers30s}</td>
              <td>${(t.duration || 0).toFixed(2)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </body>
    </html>
  `;
  await fs.mkdir(path.dirname(config.REPORT_HTML_PATH), { recursive: true });
  await fs.writeFile(config.REPORT_HTML_PATH, html);
  console.log(`INFO: HTML report saved to ${config.REPORT_HTML_PATH}`);
  pdf.create(html).toFile(config.REPORT_PDF_PATH, (err) => {
    if (err) console.error(`ERROR: Failed to create PDF: ${err.message}`);
    else console.log(`INFO: PDF report saved to ${config.REPORT_PDF_PATH}`);
  });
}

// Zip reports
async function zipReports() {
  const output = fs.createWriteStream('./runs/reports.zip');
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(output);
  archive.file(config.REPORT_JSON_PATH, { name: 'profitability_report.json' });
  archive.file(config.REPORT_HTML_PATH, { name: 'profitability_report.html' });
  archive.file(config.REPORT_PDF_PATH, { name: 'profitability_report.pdf' });
  archive.file('./runs/analyzed_tokens.json', { name: 'analyzed_tokens.json' });
  await archive.finalize();
  console.log('INFO: Reports zipped to ./runs/reports.zip');
}

// Send email alert
async function sendReportEmail(summary) {
  if (!config.EMAIL_USER || !config.EMAIL_PASS || !config.EMAIL_TO) {
    console.warn('INFO: Email alerts disabled; missing required email configuration');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: config.EMAIL_HOST,
    port: Number(config.EMAIL_PORT),
    secure: config.EMAIL_PORT === 465,
    auth: {
      user: config.EMAIL_USER,
      pass: config.EMAIL_PASS,
    },
  });

  const mailOptions = {
    from: config.EMAIL_USER,
    to: config.EMAIL_TO,
    subject: 'Pumpiyo Sniper Bot Profitability Report',
    text: `Generated: ${summary.generated}\nTotal Trades: ${summary.totalTrades}\nSuccessful Trades: ${summary.successfulTrades}\nTotal Profit: ${summary.totalProfit} SOL\nSnowball Bankroll: ${summary.bankroll} SOL\n\nView report: ${config.REPORT_HTML_PATH}`,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('INFO: Email alert sent');
  } catch (err) {
    console.error(`ERROR: Failed to send email: ${err.message}`);
  }
}

// Simulate snowball
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
async function generateInterimReport(trades) {
  const snowball = await manageSnowball(trades);
  await fs.mkdir(path.dirname(config.REPORT_JSON_PATH), { recursive: true });
  await fs.writeFile(config.REPORT_JSON_PATH, JSON.stringify(trades, null, 2));
  await generateHtmlReport(trades, snowball);
  await zipReports();

  const summary = {
    generated: format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
    totalTrades: trades.length,
    successfulTrades: trades.filter(t => t.profitSol > 0).length,
    totalProfit: trades.reduce((sum, t) => sum + t.profitSol, 0).toFixed(4),
    bankroll: snowball.bankroll.toFixed(2),
  };

  await sendReportEmail(summary);
  console.log(`INFO: Interim report generated with ${trades.length} trades`);
}

// Monitor live trades
async function generateProfitabilityReport() {
  console.log('INFO: Starting profitability report generation...');
  connection = await getConnection();
  const url = `https://api.helius.xyz/v0/addresses/${config.PUMP_FUN_PROGRAM}/transactions?api-key=${config.HELIUS_API_KEY}`;
  const seen = new Set();
  let trades = [];
  const analyzedTokens = [];

  const startTime = Date.now();
  const durationMs = 60 * 60 * 1000;
  let lastReportTime = startTime;
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
        }

        if (trades.length >= 5 || Date.now() - lastReportTime >= 5 * 60 * 1000) {
          await generateInterimReport(trades);
          await fs.writeFile('./runs/analyzed_tokens.json', JSON.stringify(analyzedTokens, null, 2));
          console.log(`INFO: Saved ${analyzedTokens.length} analyzed tokens`);
          trades = [];
          lastReportTime = Date.now();
        }
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (err) {
      console.error(`ERROR: Failed to fetch transactions: ${err.message}`);
      if (err.response?.status === 429) {
        console.warn('INFO: Switching RPC due to 429 error');
        currentRpcIndex = (currentRpcIndex + 1) % config.RPC_ENDPOINTS.length;
        connection = await getConnection();
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  if (trades.length > 0) {
    await generateInterimReport(trades);
    await fs.writeFile('./runs/analyzed_tokens.json', JSON.stringify(analyzedTokens, null, 2));
  }

  console.log('INFO: Report generation complete');
}

// Backtest historical data
async function generateProfitabilityReportFromHistory(filePath) {
  try {
    connection = await getConnection();
    const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
    console.log(`INFO: Loaded ${data.length} tokens from ${filePath}`);
    if (!data.length) throw new Error('No tokens in historical data');
    let trades = [];
    const analyzedTokens = [];
    for (const { mint, timestamp } of data) {
      console.log(`INFO: Analyzing historical token: ${mint}`);
      try {
        analyzedTokens.push({ mint, timestamp });
        const tradeLog = await simulateTrade(mint, timestamp);
        if (tradeLog) trades.push(tradeLog);
      } catch (err) {
        console.warn(`WARN: Failed to analyze ${mint}: ${err.message}`);
      }
    }
    console.log(`INFO: Processed ${trades.length} trades`);
    await fs.writeFile('./runs/analyzed_tokens.json', JSON.stringify(analyzedTokens, null, 2));
    await generateInterimReport(trades);
    console.log('INFO: Historical report generation complete');
  } catch (err) {
    console.error(`ERROR: Failed to process historical data: ${err.message}`);
    process.exit(1);
  }
}

// Run
(async () => {
  try {
    if (process.argv.includes('--fetch-latest')) {
      console.log('INFO: Fetching latest 100 tokens...');
      const url = `https://api.helius.xyz/v0/addresses/${config.PUMP_FUN_PROGRAM}/transactions?api-key=${config.HELIUS_API_KEY}`;
      const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000; // Last 3 days
      try {
        const txs = await throttledGet(url);
        const launches = txs
          .filter(tx => tx.tokenTransfers?.some(t => t.mint?.endsWith('pump')))
          .map(tx => ({
            mint: tx.tokenTransfers.find(t => t.mint?.endsWith('pump')).mint,
            timestamp: tx.timestamp * 1000,
          }))
          .filter(t => t.timestamp >= cutoff)
          .slice(0, 100); // Limit to 100 tokens
        console.log(`INFO: Fetched ${launches.length} token launches`);
        if (!launches.length) throw new Error('No recent token launches found');

        await fs.mkdir('./runs', { recursive: true });
        await fs.writeFile('./runs/historical_tokens.json', JSON.stringify(launches, null, 2));
        console.log(`INFO: Saved ${launches.length} tokens to ./runs/historical_tokens.json`);

        await generateProfitabilityReportFromHistory('./runs/historical_tokens.json');
      } catch (err) {
        console.error(`ERROR: Failed to fetch recent token launches: ${err.message}`);
        process.exit(1);
      }
    } else if (process.argv[2]) {
      await generateProfitabilityReportFromHistory(process.argv[2]);
    } else {
      await generateProfitabilityReport();
    }
  } catch (err) {
    console.error(`ERROR: Fatal error: ${err.message}`);
    process.exit(1);
  }
})();