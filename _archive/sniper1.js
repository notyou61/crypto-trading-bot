// sniper1.js
import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import { Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { getSolPrice } from './getSolPrice.js';
import { getBuyerStats } from './utils/getBuyerStats.js';
import { getTokenPrice } from './utils/getTokenPrice.js';
import { shouldTriggerReport } from './utils/reportThresholds.js';
import fetchRecentMints from './utils/fetchRecentMints.js';
import generateAfterActionReport from './utils/generateAfterActionReport.js';

const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const HOLD_LIMIT_MS = parseInt(process.env.MAX_HOLD_TIME || '120000'); // 120s for Strategy v3
const ENTRY_TRIGGER = parseFloat(process.env.ENTRY_TRIGGER || '1.05');
const EXIT_TARGET = parseFloat(process.env.EXIT_TARGET || '3.0'); // 200% gain for Strategy v3
const PARTIAL_EXIT = parseFloat(process.env.PARTIAL_EXIT || '1.5'); // 50% gain as fallback
const TRADE_SIZE = parseFloat(process.env.TRADE_SIZE || '0.05');
const SLIPPAGE = parseFloat(process.env.SLIPPAGE || '0.03');
const TX_FEE = parseFloat(process.env.TX_FEE || '0.0001');
const MIN_BUYERS = parseInt(process.env.MIN_BUYERS || '5');
const MIN_VOLUME = parseFloat(process.env.MIN_VOLUME || '0.3');

let simulatedBalance = 0.5;
let totalProfit = 0;
let tradeCount = [];
let tradeHistory = [];
let lastReportTime = Date.now();
const trackedTokens = new Map();

// 🔐 Decode wallet
let keypair;
try {
  keypair = process.env.HOT_WALLET_PRIVATE_KEY
    ? Keypair.fromSecretKey(bs58.decode(process.env.HOT_WALLET_PRIVATE_KEY))
    : Keypair.generate(); // Fallback to fake keypair for paper trading
  console.log(`🚀 Sniper Bot Started (Paper Trading)`);
  console.log(`✅ Wallet Public Key: ${keypair.publicKey.toBase58()}`);
  console.log(`💰 Simulated Balance: ${simulatedBalance.toFixed(4)} SOL`);
} catch (e) {
  console.error(`❌ Invalid private key: ${e.message}`);
  process.exit(1);
}

// 🧠 Ensure sufficient balance
async function checkBalance(amount) {
  if (simulatedBalance < amount + TX_FEE) {
    throw new Error(`Insufficient simulated balance: ${simulatedBalance.toFixed(4)} SOL`);
  }
  return simulatedBalance;
}

// 💸 Simulated Buy
async function simulateSwap(tokenAddress, amount, price) {
  const tokensBought = (amount / price) * (1 - SLIPPAGE);
  const cost = amount + TX_FEE;
  await checkBalance(amount);
  simulatedBalance -= cost;
  console.log(`🟢 Simulated Buy: ${amount} SOL -> ${tokensBought.toFixed(2)} tokens (${tokenAddress.slice(0, 8)}...) at $${price.toFixed(6)}`);
  console.log(`💰 New Balance: ${simulatedBalance.toFixed(4)} SOL`);
  return { tokensBought, cost };
}

// 💸 Simulated Sell
async function simulateSell(tokenAddress, tokens, price, metadata) {
  const solReceived = tokens * price * (1 - SLIPPAGE);
  const profit = solReceived - metadata.solSpent - TX_FEE;
  simulatedBalance += solReceived - TX_FEE;
  totalProfit += profit;
  tradeCount.push(profit);
  console.log(`🔴 Simulated Sell: ${tokens.toFixed(2)} tokens (${tokenAddress.slice(0, 8)}...) -> ${solReceived.toFixed(4)} SOL at $${price.toFixed(6)}`);
  console.log(`📊 Gain: ${((metadata.gain - 1) * 100).toFixed(2)}% | ${profit >= 0 ? '🟢 Profit' : '🔴 Loss'}: ${profit.toFixed(4)} SOL | Total Profit: ${totalProfit.toFixed(4)} SOL | Trades: ${tradeCount.length} | ${metadata.exitReason}`);
  console.log(`💰 New Balance: ${simulatedBalance.toFixed(4)} SOL`);

  tradeHistory.push({
    ...metadata,
    exitPrice: price,
    solReceived,
    profit,
  });

  return profit;
}

// 🔍 Evaluate each token for buy trigger
async function evaluateMints() {
  try {
    const tokens = await fetchRecentMints(25);
    console.log(`📦 Received ${tokens.length} new tokens from fetchRecentMints`);
    for (const token of tokens) {
      const { tokenAddress, signature, createdAt } = token;
      if (!tokenAddress || typeof tokenAddress !== 'string') {
        console.warn(`⚠️ Skipping invalid token: ${JSON.stringify(token)}`);
        continue;
      }
      if (trackedTokens.has(tokenAddress)) {
        console.log(`⏭️ Skipped: Token ${tokenAddress.slice(0, 8)}... already tracked`);
        continue;
      }

      console.log(`⏳ Evaluating token: ${tokenAddress.slice(0, 8)}...`);
      const initialPrice = await getTokenPrice(tokenAddress, createdAt);
      const priceNow = await getTokenPrice(tokenAddress, Date.now());
      if (!initialPrice || initialPrice <= 0 || !priceNow || priceNow <= 0) {
        console.warn(`⚠️ Skipping ${tokenAddress.slice(0, 8)}...: Invalid price (Initial: ${initialPrice}, Current: ${priceNow})`);
        continue;
      }

      let buyers;
      try {
        buyers = await getBuyerStats(signature);
        if (!buyers || buyers.buyerCount < MIN_BUYERS || buyers.volume < MIN_VOLUME) {
          console.log(`❌ Rejected: ${tokenAddress.slice(0, 8)}... (Buyers: ${buyers?.buyerCount || 0}, Volume: ${buyers?.volume?.toFixed(2) || 0} SOL)`);
          continue;
        }
      } catch (err) {
        console.warn(`⚠️ Skipping ${tokenAddress.slice(0, 8)}...: Buyer stats error (${err.message})`);
        continue;
      }

      const gain = priceNow / initialPrice;
      console.log(`🔍 ${tokenAddress.slice(0, 8)}... | Buyers: ${buyers.buyerCount} | Volume: ${buyers.volume.toFixed(2)} SOL`);
      console.log(`📈 [${new Date().toLocaleTimeString()}] Price Check: +${((gain - 1) * 100).toFixed(2)}%`);

      if (gain >= ENTRY_TRIGGER) {
        console.log(`✅ Entry Trigger Met: Simulating buy for ${tokenAddress.slice(0, 8)}...`);
        const { tokensBought, cost } = await simulateSwap(tokenAddress, TRADE_SIZE, priceNow);
        trackedTokens.set(tokenAddress, {
          entryPrice: priceNow,
          entryTime: Date.now(),
          solSpent: cost,
          tokensBought,
          buySignature: signature,
          createdAt,
          status: 'holding',
        });
        console.log(`🚀 Holding token ${tokenAddress.slice(0, 8)}...`);
      } else {
        console.log(`❌ Rejected: Not enough gain for ${tokenAddress.slice(0, 8)}... (Gain: ${((gain - 1) * 100).toFixed(2)}%)`);
      }
    }
  } catch (e) {
    console.error(`⚠️ Error in evaluateMints: ${e.message}`);
  }
}

// 📈 Evaluate exits for tracked tokens
async function evaluateExits() {
  const now = Date.now();
  for (const [tokenAddress, data] of trackedTokens.entries()) {
    if (data.status !== 'holding') continue;

    try {
      const age = now - data.entryTime;
      const currentPrice = await getTokenPrice(tokenAddress, now);
      if (!currentPrice || currentPrice <= 0) {
        console.warn(`⚠️ Invalid price for ${tokenAddress.slice(0, 8)}...: $${currentPrice || 0}`);
        trackedTokens.delete(tokenAddress);
        continue;
      }

      const gain = currentPrice / data.entryPrice;
      console.log(`⏱ Holding ${tokenAddress.slice(0, 8)}... Gain: +${((gain - 1) * 100).toFixed(2)}% | Elapsed: ${(age / 1000).toFixed(0)}s`);

      let shouldSell = false;
      let exitReason = '';

      if (gain >= EXIT_TARGET && age >= 60000) {
        shouldSell = true;
        exitReason = '🚀 Supermoon (+200%)';
      } else if (gain >= PARTIAL_EXIT || age >= HOLD_LIMIT_MS) {
        shouldSell = true;
        exitReason = gain >= PARTIAL_EXIT ? '📈 Partial Exit (+50%)' : '⏱ Timeout (120s)';
      }

      if (shouldSell) {
        await simulateSell(tokenAddress, data.tokensBought, currentPrice, {
          token: tokenAddress,
          entryTime: data.entryTime,
          entryPrice: data.entryPrice,
          solSpent: data.solSpent,
          gain,
          exitType: exitReason.includes('Supermoon') ? 'Moonshot' : 'Partial/Fallback',
          exitReason,
          duration: age,
        });
        trackedTokens.delete(tokenAddress);
      }
    } catch (e) {
      console.error(`⚠️ Error evaluating exit for ${tokenAddress.slice(0, 8)}...: ${e.message}`);
    }
  }
}

// 📝 Generate and save report if conditions are met
async function generateReport() {
  const now = Date.now();
  if (shouldTriggerReport(tradeHistory, lastReportTime)) {
    try {
      const report = await generateAfterActionReport(tradeHistory);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const reportPath = `./runs/report_${timestamp}.html`;
      fs.mkdirSync('./runs', { recursive: true });
      fs.writeFileSync(reportPath, report);
      console.log(`📝 Generated report: ${reportPath}`);
      tradeHistory = [];
      lastReportTime = now;
    } catch (e) {
      console.error(`⚠️ Error generating report: ${e.message}`);
    }
  }
}

// 🔁 Main loop
async function mainLoop() {
  setInterval(async () => {
    try {
      await evaluateMints();
      await evaluateExits();
      await generateReport();
      console.log(`📊 Current Balance: ${simulatedBalance.toFixed(4)} SOL | Held Tokens: ${trackedTokens.size}`);
      console.log(`📈 Trades: ${tradeCount.length} | Net Profit: ${totalProfit.toFixed(4)} SOL`);
    } catch (e) {
      console.error(`⚠️ Main loop error: ${e.message}`);
    }
  }, 10000); // 10s interval
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
});

mainLoop();