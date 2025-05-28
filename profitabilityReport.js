// profitabilityReport.js
import { Connection, PublicKey } from '@solana/web3.js';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import { format } from 'date-fns';
import nodemailer from 'nodemailer';
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

const rpcLimiter = new RateLimiter(2); // 2 req/s for safety

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

// Initialize connection with failover
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

// Fetch token supply with cache
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

// Calculate token price
function calculatePrice(tokenSupply, solInVault) {
  const basePrice = solInVault / tokenSupply;
  const curveFactor = Math.log10(tokenSupply / 1_000_000 + 1) * 0.1;
  return basePrice * curveFactor;
}

// Fetch buyer stats
async function getBuyerStats(mintAddress, startTime) {
  try {
    await rpcLimiter.wait();
    const mintPubkey = new PublicKey(mintAddress);
    const signatures = await connection.getSignaturesForAddress(mintPubkey, { limit: 1000 });
    if (!signatures.length) {
      console.log(`INFO: No transactions found for ${mintAddress}, assuming 0 buyers`);
      return { buyers10s: 0, buyers30s: 0 };
    }

    const transfers = [];
    for (const sig of signatures) {
      if (sig.blockTime * 1000 < startTime || sig.blockTime * 1000 > startTime + 30000) continue;
      await rpcLimiter.wait();
      const tx = await connection.getParsedTransaction(sig.signature, { maxSupportedTransactionVersion: 0 });
      if (!tx) continue;

      const tokenTransfers = tx.meta?.innerInstructions?.flatMap(ii =>
        ii.instructions.filter(i =>
          i.programId.toString() === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' &&
          i.parsed?.type === 'transfer' &&
          i.parsed?.info?.mint === mintAddress
        )
      ) || [];

      for (const transfer of tokenTransfers) {
        transfers.push({
          timestamp: sig.blockTime,
          toUserAccount: transfer.parsed.info.destination,
        });
      }
    }

    const buyers10s = new Set(
      transfers
        .filter(t => t.timestamp * 1000 >= startTime && t.timestamp * 1000 <= startTime + 10000)
        .filter(t => t.toUserAccount !== mintAddress)
        .map(t => t.toUserAccount)
    ).size;
    const buyers30s = new Set(
      transfers
        .filter(t => t.timestamp * 1000 >= startTime && t.timestamp * 10000 <= startTime + 30000)
        .filter(t => t.toUserAccount !== mintAddress)
        .map(t => t.toUserAccount)
    ).size;

    console.log(`INFO: Buyer stats for ${mintAddress}: ${buyers10s} (10s), ${buyers30s} (30s)`);
    return { buyers10s, buyers30s };
  } catch (err) {
    console.warn(`WARN: Failed to fetch buyer stats for ${mintAddress}: ${err.message}, assuming 0 buyers`);
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

  if (buyerStats.buyers10s < 1) {
    console.log(`INFO: Skipping trade for ${mintAddress} due to insufficient buyers (${buyerStats.buyers10s}/1)`);
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

    if (!tradeExecuted && currentPrice >= initialPrice * 1.10) {
      tradeExecuted = true;
      tradeLog.entryPrice = currentPrice;
      tradeLog.status = 'entered';
      console.log(`INFO: [Simulated] Buying ${mintAddress} at ${currentPrice.toFixed(8)} SOL`);
    }

    if (tradeExecuted) {
      const priceGain = (currentPrice / tradeLog.entryPrice - 1) * 100;
      const holdTime = (Date.now() - simStart) / 1000;

      if (priceGain >= 200 && holdTime >= 60) {
        tradeLog.exitPrice = currentPrice;
        tradeLog.profitSol = (currentPrice - tradeLog.entryPrice) * (config.TRADE_SIZE / tradeLog.entryPrice) - config.TX_FEE;
        tradeLog.profitUsd = tradeLog.profitSol * solPrice;
        tradeLog.status = 'moonshot';
        tradeLog.duration = holdTime;
        console.log(`INFO: [Simulated] Moonshot exit: ${tradeLog.profitSol.toFixed(4)} SOL`);
        break;
      } else if (priceGain >= 50 || holdTime >= 120) {
        tradeLog.exitPrice = currentPrice;
        tradeLog.profitSol = (currentPrice - tradeLog.entryPrice) * (config.TRADE_SIZE / tradeLog.entryPrice) - config.TX_FEE;
        tradeLog.profitUsd = tradeLog.profitSol * solPrice;
        tradeLog.status = priceGain >= 50 ? 'partial' : 'timeout';
        tradeLog.duration = holdTime;
        console.log(`INFO: [Simulated] ${tradeLog.status} exit: ${tradeLog.profitSol.toFixed(4)} SOL`);
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

// Monitor and simulate trades
async function generateProfitabilityReport() {
  console.log('INFO: Starting profitability report generation...');
  connection = await getConnection();
  const url = `https://api.helius.xyz/v0/addresses/${config.PUMP_FUN_PROGRAM}/transactions?api-key=${config.HELIUS_API_KEY}`;
  const seen = new Set();
  let trades = [];

  const startTime = Date.now();
  const durationMs = 60 * 60 * 1000; // 1 hour
  let lastReportTime = startTime;
  while (Date.now() - startTime < durationMs) {
    try {
      const txs = await throttledGet(url);
      for (const tx of txs) {
        const transfer = tx.tokenTransfers?.find(t => t.mint?.endsWith('pump') && !seen.has(t.mint));
        if (!transfer?.mint) continue;

        seen.add(transfer.mint);
        console.log(`INFO: Analyzing token: ${transfer.mint}`);
        const tradeLog = await simulateTrade(transfer.mint, tx.timestamp * 1000);
        if (tradeLog) trades.push(tradeLog);

        // Generate report after each trade
        if (trades.length >= 1 || Date.now() - lastReportTime >= 5 * 60 * 1000) {
          await generateInterimReport(trades);
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
  }

  console.log('INFO: Report generation complete');
}

// Historical backtest
async function generateProfitabilityReportFromHistory(filePath) {
  try {
    connection = await getConnection();
    const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
    let trades = [];
    for (const { mint, timestamp } of data) {
      console.log(`INFO: Analyzing historical token: ${mint}`);
      const tradeLog = await simulateTrade(mint, timestamp);
      if (tradeLog) trades.push(tradeLog);
    }
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
    if (process.argv[2]) {
      await generateProfitabilityReportFromHistory(process.argv[2]);
    } else {
      await generateProfitabilityReport();
    }
  } catch (err) {
    console.error(`ERROR: Fatal error: ${err.message}`);
    process.exit(1);
  }
})();