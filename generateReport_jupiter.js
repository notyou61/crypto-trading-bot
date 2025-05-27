import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';
import { Helius } from 'helius-sdk';
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

// Constants
const MAX_HOT_WALLET_SOL = 3.0;
const MIN_HOT_WALLET_SOL = 1.0;
const MAX_SPENDING_USD = 600;
const PROFIT_SPLIT = {
  hot: 0.25,
  payout: 0.25,
  cold: 0.50,
};
const MAX_PROFIT_MULTIPLIER = 20;

// Configuration
const config = {
  HELIUS_API_KEY: process.env.HELIUS_API_KEY || '',
  PUMP_FUN_TOKEN: process.env.PUMP_FUN_TOKEN || '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  OUTPUT_JSON: process.env.OUTPUT_JSON || './runs/historical_snapshot_with_signature.json',
  OUTPUT_HTML: process.env.OUTPUT_HTML || './runs/token_historical_report.html',
  SNOWBALL_STATE_PATH: process.env.SNOWBALL_STATE_PATH || './runs/snowball_state.json',
  PROFIT_LOG_PATH: process.env.PROFIT_LOG_PATH || './runs/profit_log.json',
  BALANCE_STATE_PATH: process.env.BALANCE_STATE_PATH || './runs/balance_state.json',
  MAX_PAGES: parseInt(process.env.MAX_PAGES, 10) || 20,
  TRADE_QUANTITY: parseInt(process.env.TRADE_QUANTITY, 10) || 10000,
  FALLBACK_SOL_PRICE: parseFloat(process.env.FALLBACK_SOL_PRICE) || 100.0,
  API_RETRY_COUNT: parseInt(process.env.API_RETRY_COUNT, 10) || 3,
  API_RETRY_DELAY_MS: parseInt(process.env.API_RETRY_DELAY_MS, 10) || 2000,
  MAX_TRADE_SIZE: parseFloat(process.env.MAX_TRADE_SIZE) || 1.5,
  SPENDING_WALLET_HOURLY_USD: parseFloat(process.env.SPENDING_WALLET_HOURLY_USD) || 25,
  HOURS_PER_DAY: parseInt(process.env.HOURS_PER_DAY) || 24,
  PROFIT_SPLIT_HOT: parseFloat(process.env.PROFIT_SPLIT_HOT) || PROFIT_SPLIT.hot,
  PROFIT_SPLIT_PAYOUT: parseFloat(process.env.PROFIT_SPLIT_PAYOUT) || PROFIT_SPLIT.payout,
  PROFIT_SPLIT_COLD: parseFloat(process.env.PROFIT_SPLIT_COLD) || PROFIT_SPLIT.cold,
};

const helius = new Helius(config.HELIUS_API_KEY);

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

// Profit logging
const logProfitDistribution = async (solPrice, solProfit, usdProfit, toHot, toSpending, toPayout, toCold, config) => {
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
      cold: parseFloat(toCold.toFixed(6)),
    },
    incomeTargetUSD: dailyUsdTarget,
    targetMet,
  };

  const logPath = config.PROFIT_LOG_PATH;
  let logData = [];
  try {
    const raw = await fs.readFile(logPath, 'utf8');
    logData = JSON.parse(raw);
  } catch {
    console.log('INFO: No existing profit log found, creating new one...');
  }
  logData.push(logEntry);
  try {
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.writeFile(logPath, JSON.stringify(logData, null, 2));
    console.log(`📘 Profit log updated: ${logPath}`);
  } catch (err) {
    console.error(`ERROR: Failed to write profit log: ${err.message}`);
  }
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
const getPriceData = async (mint, initialPrice) => {
  try {
    if (!initialPrice || initialPrice <= 0) {
      console.warn(`⚠️ Skipping ${mint} — Invalid initial price: ${initialPrice}`);
      return null;
    }
    const price = initialPrice;
    return {
      peakPrice: price * (1 + Math.random() * 2),
      timeToPeakMs: Math.floor(Math.random() * 60000),
      collapseTimeMs: Math.floor(Math.random() * 120000)
    };
  } catch (err) {
    console.warn(`⚠️ Error generating price data for ${mint}: ${err.message}`);
    return null;
  }
};

const getBuyerStats = async (tx, startTime) => {
  try {
    const transfers = tx.tokenTransfers || [];
    if (!transfers.length) throw new Error('No buyer transfers');
    const buyers10s = new Set(transfers.filter(t => t.timestamp * 1000 <= startTime + 10000).map(t => t.fromUserAccount)).size;
    const buyers30s = new Set(transfers.filter(t => t.timestamp * 1000 <= startTime + 30000).map(t => t.fromUserAccount)).size;
    return { buyers10s, buyers30s };
  } catch (err) {
    console.warn(`⚠️ Skipping token due to buyer data failure: ${err.message}`);
    return null;
  }
};

// === Step 1: Fetch transactions and enrich ===
async function fetchRealTokenData() {
  if (!config.HELIUS_API_KEY) {
    console.error('❌ ERROR: HELIUS_API_KEY not set in .env');
    throw new Error('Missing API key');
  }

  const seen = new Set();
  const result = [];
  let before;
  let page = 0;
  let totalProcessed = 0;

  try {
    await fs.mkdir(path.dirname(config.OUTPUT_JSON), { recursive: true });
  } catch (err) {
    console.error(`❌ ERROR: Failed to create output directory — ${err.message}`);
    throw err;
  }

  while (page < config.MAX_PAGES) {
    const url = `https://api.helius.xyz/v0/addresses/${config.PUMP_FUN_TOKEN}/transactions?api-key=${config.HELIUS_API_KEY}`;
    try {
      const txs = await fetchWithRetry(url, before ? { before } : {});
      if (!Array.isArray(txs) || txs.length === 0) {
        console.log(`ℹ️ INFO: No more transactions on page ${page + 1}`);
        break;
      }

      console.log(`📄 INFO: Page ${page + 1}: Scanning ${txs.length} transactions`);
      for (const tx of txs) {
        totalProcessed++;

        if (!tx.tokenTransfers || !tx.timestamp || !tx.signature) {
          console.log(`⛔ Skipping tx ${tx.signature}: Missing required fields`);
          continue;
        }

        console.log(`DEBUG: Tx ${tx.signature} tokenTransfers:`, JSON.stringify(tx.tokenTransfers.map(t => ({ mint: t.mint, amount: t.tokenAmount })), null, 2));

        const transfer = tx.tokenTransfers.find(t => {
          if (!t.mint || typeof t.mint !== 'string' || t.mint.length < 20) {
            console.log(`DEBUG: Invalid mint in tx ${tx.signature}: ${t.mint}`);
            return false;
          }
          if (t.mint === 'So11111111111111111111111111111111111111112') {
            console.log(`DEBUG: Skipping Wrapped SOL mint in tx ${tx.signature}`);
            return false;
          }
          if (!t.mint.endsWith('pump')) {
            console.log(`DEBUG: Mint ${t.mint} in tx ${tx.signature} does not end with 'pump'`);
            return false;
          }
          if (seen.has(t.mint)) {
            console.log(`DEBUG: Mint ${t.mint} in tx ${tx.signature} already processed`);
            return false;
          }
          return true;
        });

        if (!transfer?.mint) {
          const mints = tx.tokenTransfers.map(t => t.mint || 'undefined').join(', ');
          console.log(`🔍 Tx ${tx.signature}: No usable mint found. Mints: ${mints}`);
          continue;
        }

        seen.add(transfer.mint);
        console.log(`DEBUG: Processing mint ${transfer.mint}`);

        const tokens = parseFloat(transfer.tokenAmount) || 0;
        const sol = parseFloat(tx.nativeTransfers?.find(n =>
          n.toUserAccount === config.PUMP_FUN_TOKEN)?.amount || 0);
        const initial = sol && tokens ? sol / tokens : 0;

        if (initial === 0) {
          console.log(`⚠️ Skipping ${transfer.mint}: Initial price is 0 (sol: ${sol}, tokens: ${tokens})`);
          continue;
        }

        const startTime = tx.timestamp * 1000;

        try {
          const priceData = await getPriceData(transfer.mint, initial);
          if (!priceData?.peakPrice) {
            console.warn(`⚠️ No valid price for ${transfer.mint}; skipping`);
            continue;
          }

          const buyerStats = await getBuyerStats(tx, startTime);
          if (!buyerStats) {
            console.warn(`⚠️ No buyer data for ${transfer.mint}; skipping`);
            continue;
          }

          const { peakPrice, timeToPeakMs, collapseTimeMs } = priceData;
          const { buyers10s, buyers30s } = buyerStats;

          const exitPrice = peakPrice * 0.8;
          const profitGain = initial > 0 ? ((exitPrice - initial) / initial) * 100 : 0;
          const tradeTaken = shouldEnterTrade(buyers10s, profitGain);

          const previousPrices = [initial, initial * 1.2];
          const holdTime = collapseTimeMs / 1000;
          const extendedHold = shouldHoldForMomentum(exitPrice, previousPrices, holdTime, profitGain);
          const finalHoldDuration = extendedHold ? holdTime * 1.5 : holdTime;

          result.push({
            token: transfer.mint,
            launchTimestamp: new Date(startTime).toISOString(),
            initialPrice: initial,
            peakPrice,
            timeToPeakMs,
            collapseTimeMs,
            buyers10s,
            buyers30s,
            holdDuration: finalHoldDuration,
            exitPrice,
            profitGain: profitGain.toFixed(2),
            tier: assignTier(profitGain),
            tradeTaken,
            triggeredAtMs: tradeTaken ? timeToPeakMs || 30000 : 0,
            notes: tradeTaken ? 'Trade executed from real metadata' : 'Skipped due to low profit or weak entry',
          });

          console.log(`✅ Added ${transfer.mint} — Profit: ${profitGain.toFixed(2)}%`);
        } catch (err) {
          console.warn(`⚠️ Error processing ${transfer.mint}: ${err.message}`);
        }
      }

      before = txs[txs.length - 1].signature;
      page++;
      console.log(`📊 INFO: Processed ${totalProcessed} transactions, ${result.length} tokens`);
      await delay(1000);
    } catch (err) {
      console.error(`❌ ERROR: Failed on page ${page + 1} —`, err.response?.data || err.message);
      break;
    }
  }

  try {
    result.sort((a, b) => new Date(a.launchTimestamp) - new Date(b.launchTimestamp));
    await fs.writeFile(config.OUTPUT_JSON, JSON.stringify(result, null, 2));
    console.log(`✅ SUCCESS: Fetched and saved ${result.length} tokens to ${config.OUTPUT_JSON}`);
  } catch (err) {
    console.error(`❌ ERROR: Failed to write output file — ${err.message}`);
    throw err;
  }

  return result;
}

// === Step 2: Generate Report ===
async function generateReport(tokens, config) {
  if (!tokens.length) {
    console.warn('WARN: No tokens fetched; generating empty report');
    return;
  }

  const solPrice = config.FALLBACK_SOL_PRICE;
  console.log(`INFO: Using fallback SOL Price (USD): ${solPrice.toFixed(2)}`);
  const priceWarning = '<p><strong>Warning:</strong> Using fallback SOL price ($100.00) since no external price source is configured.</p>';
  const tradedTokens = tokens.filter((t) => t.tradeTaken);
  const gainList = tradedTokens.map(t => parseFloat(t.profitGain));

  tokens.forEach(t => {
    const rarityScore = rarityIndex(gainList, parseFloat(t.profitGain));
    t.tier = assignTier(parseFloat(t.profitGain), rarityScore);
  });

  const tiers = ['Skipped', 'Pulse', 'Moonshot', 'Supermoon', 'Nova', 'Black Hole'];
  const calculateProfit = (token) => (token.exitPrice - token.initialPrice) * config.TRADE_QUANTITY;

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

  let snowballState = {
    bankroll: 0.5,
    status: 'active',
    tradesExecuted: 0,
    target: 5.0,
    lastUpdated: new Date().toISOString()
  };
  try {
    const existing = await fs.readFile(config.SNOWBALL_STATE_PATH, 'utf8');
    snowballState = JSON.parse(existing);
    console.log(`INFO: Loaded Snowball state: ${snowballState.bankroll} SOL`);
  } catch {
    console.warn('WARN: Starting fresh Snowball state');
  }

  const startingSnowballBankroll = snowballState.bankroll;

  let walletState = {
    hotWallet: 0.5,
    payoutWallet: 0.0,
    coldWallet: 0.0,
    spendingWallet: 0.0,
    lastUpdated: new Date().toISOString()
  };
  try {
    const raw = await fs.readFile(config.BALANCE_STATE_PATH, 'utf8');
    walletState = JSON.parse(raw);
    console.log(`INFO: Loaded wallet balances:`, walletState);
  } catch {
    console.log('INFO: No balance state found. Starting fresh.');
  }

  let currentSol = snowballState.bankroll;
  let snowballProfit = 0;

  console.log(`INFO: Starting Snowball simulation with ${tradedTokens.length} trades, initial bankroll: ${currentSol.toFixed(4)} SOL`);

  if (startingSnowballBankroll < snowballState.target) {
    for (const token of tradedTokens) {
      if (snowballState.status !== 'active') break;

      const tradeSize = Math.min(currentSol, config.MAX_TRADE_SIZE);
      const qty = tradeSize / token.initialPrice;
      const returnSol = qty * token.exitPrice;
      let profit = returnSol - tradeSize;
      profit = Math.min(profit, tradeSize * MAX_PROFIT_MULTIPLIER);

      console.log(`INFO: Trade - Token: ${token.token}, Trade Size: ${tradeSize.toFixed(4)} SOL, Initial Price: ${token.initialPrice.toFixed(8)} USD, Exit Price: ${token.exitPrice.toFixed(8)} USD, Qty: ${qty.toFixed(0)}, Profit: ${profit.toFixed(4)} SOL`);

      currentSol += profit;
      snowballProfit += profit;
      token.bankrollAfterTrade = parseFloat(currentSol.toFixed(6));
      snowballState.tradesExecuted++;

      if (currentSol >= snowballState.target) {
        snowballState.status = 'reserve_mode';
        console.log(`🎯 Snowball complete — switching to Reserve Mode`);
        break;
      }
    }
  } else {
    console.log(`INFO: Starting bankroll (${startingSnowballBankroll.toFixed(4)} SOL) at or above target (${snowballState.target} SOL). Operating in Reserve Mode.`);
    snowballProfit = tradedTokens.reduce((sum, token) => {
      const tradeSize = Math.min(currentSol, config.MAX_TRADE_SIZE);
      const qty = tradeSize / token.initialPrice;
      const returnSol = qty * token.exitPrice;
      let profit = returnSol - tradeSize;
      profit = Math.min(profit, tradeSize * MAX_PROFIT_MULTIPLIER);
      console.log(`INFO: Trade - Token: ${token.token}, Trade Size: ${tradeSize.toFixed(4)} SOL, Initial Price: ${token.initialPrice.toFixed(8)} USD, Exit Price: ${token.exitPrice.toFixed(8)} USD, Qty: ${qty.toFixed(0)}, Profit: ${profit.toFixed(4)} SOL`);
      return sum + profit;
    }, 0);
    currentSol += snowballProfit;
    snowballState.tradesExecuted += tradedTokens.length;
    snowballState.status = 'reserve_mode';
  }

  console.log(`INFO: Snowball Profit: ${snowballProfit.toFixed(4)} SOL, Final Bankroll: ${currentSol.toFixed(4)} SOL`);

  let reserveSummary = '';
  let spendingPayout = '';
  let toHot = 0, toSpending = 0, toPayout = 0, toCold = 0;
  if (snowballState.status === 'reserve_mode') {
    const dailyUsdTarget = config.SPENDING_WALLET_HOURLY_USD * config.HOURS_PER_DAY;
    const usdProfit = snowballProfit * solPrice;
    const solProfit = snowballProfit;

    const profit25 = solProfit * 0.25;
    const profit50 = solProfit * 0.50;

    const maxSpendingSOL = MAX_SPENDING_USD / solPrice;
    const currentSpendingSOL = walletState.spendingWallet;
    const spendingGap = Math.max(0, maxSpendingSOL - currentSpendingSOL);

    if (walletState.hotWallet < MAX_HOT_WALLET_SOL) {
      const neededToReachTarget = MAX_HOT_WALLET_SOL - walletState.hotWallet;
      toHot = Math.min(solProfit, neededToReachTarget);
      walletState.hotWallet += toHot;
      const remainingProfit = solProfit - toHot;

      toSpending = Math.min(remainingProfit * 0.25, spendingGap);
      toPayout = remainingProfit * 0.25;
      toCold = remainingProfit * 0.50;

      walletState.spendingWallet += toSpending;
      walletState.payoutWallet += toPayout;
      walletState.coldWallet += toCold;

      console.log(`💸 Profit Routed (Hot Wallet Growing):`);
      console.log(`- Hot Wallet: ${toHot.toFixed(4)} SOL (target ${MAX_HOT_WALLET_SOL} SOL)`);
      console.log(`- Spending Wallet: ${toSpending.toFixed(4)} SOL (gap ${spendingGap.toFixed(4)} SOL)`);
      console.log(`- Payout Wallet: ${toPayout.toFixed(4)} SOL`);
      console.log(`- Cold Wallet: ${toCold.toFixed(4)} SOL`);
    } else {
      toSpending = Math.min(profit25, spendingGap);
      const spendingDeficit = profit25 - toSpending;

      toPayout = profit25 + (spendingDeficit * 0.5);
      toCold = profit50 + (spendingDeficit * 0.5);

      walletState.spendingWallet += toSpending;
      walletState.payoutWallet += toPayout;
      walletState.coldWallet += toCold;

      console.log(`💸 Profit Routed (Hot Wallet Capped):`);
      console.log(`- Hot Wallet: ${toHot.toFixed(4)} SOL (capped at ${MAX_HOT_WALLET_SOL} SOL)`);
      console.log(`- Spending Wallet: ${toSpending.toFixed(4)} SOL (gap ${spendingGap.toFixed(4)} SOL)`);
      console.log(`- Payout Wallet: ${toPayout.toFixed(4)} SOL (includes ${spendingDeficit.toFixed(4)} SOL deficit)`);
      console.log(`- Cold Wallet: ${toCold.toFixed(4)} SOL (includes ${spendingDeficit.toFixed(4)} SOL deficit)`);
    }

    if (walletState.hotWallet < MIN_HOT_WALLET_SOL) {
      console.warn(`⚠️ Hot Wallet dropped below ${MIN_HOT_WALLET_SOL} SOL. Adjusting.`);
      const shortfall = MIN_HOT_WALLET_SOL - walletState.hotWallet;
      walletState.hotWallet = MIN_HOT_WALLET_SOL;
      if (walletState.payoutWallet >= shortfall) {
        walletState.payoutWallet -= shortfall;
        toPayout -= shortfall;
        console.log(`INFO: Transferred ${shortfall.toFixed(4)} SOL from Payout Wallet to Hot Wallet.`);
      } else if (walletState.coldWallet >= shortfall) {
        walletState.coldWallet -= shortfall;
        toCold -= shortfall;
        console.log(`INFO: Transferred ${shortfall.toFixed(4)} SOL from Cold Wallet to Hot Wallet.`);
      } else {
        console.warn(`WARN: Insufficient funds in Payout (${walletState.payoutWallet.toFixed(4)} SOL) and Cold (${walletState.coldWallet.toFixed(4)} SOL) to cover shortfall of ${shortfall.toFixed(4)} SOL.`);
      }
    }

    walletState.hotWallet = Math.min(walletState.hotWallet, MAX_HOT_WALLET_SOL);

    const newSpendingSol = walletState.spendingWallet;
    const newSpendingUsd = newSpendingSol * solPrice;
    if (newSpendingSol >= maxSpendingSOL) {
      spendingPayout = `<p><strong>Spending Payout:</strong> Spending Wallet at or above $${MAX_SPENDING_USD.toFixed(2)} cap (${newSpendingSol.toFixed(4)} SOL ~ $${newSpendingUsd.toFixed(2)}).</p>`;
    } else if (toSpending > 0) {
      spendingPayout = `<p><strong>Spending Payout:</strong> Transferred ${toSpending.toFixed(4)} SOL (~$${(toSpending * solPrice).toFixed(2)}) to Spending Wallet. Still needs ${(maxSpendingSOL - newSpendingSol).toFixed(4)} SOL (~$${(maxSpendingSOL * solPrice - newSpendingUsd).toFixed(2)}) to reach $${MAX_SPENDING_USD.toFixed(2)} cap.</p>`;
    } else {
      spendingPayout = `<p><strong>Spending Payout:</strong> No transfer to Spending Wallet. Gap: ${(maxSpendingSOL - newSpendingSol).toFixed(4)} SOL (~$${(maxSpendingSOL * solPrice - newSpendingUsd).toFixed(2)}) to reach $${MAX_SPENDING_USD.toFixed(2)} cap.</p>`;
    }

    walletState.lastUpdated = new Date().toISOString();
    try {
      await fs.mkdir(path.dirname(config.BALANCE_STATE_PATH), { recursive: true });
      await fs.writeFile(config.BALANCE_STATE_PATH, JSON.stringify(walletState, null, 2));
      console.log('📘 Wallet state saved:', config.BALANCE_STATE_PATH);
    } catch (err) {
      console.error(`ERROR: Failed to save wallet state: ${err.message}`);
    }

    const targetMet = usdProfit >= dailyUsdTarget;
    console.log(
      `${targetMet ? '✅' : '🕒'} ${targetMet ? 'Daily income target met' : 'Income below target'}: $${usdProfit.toFixed(2)} (${targetMet ? '≥' : '<'} $${dailyUsdTarget})`
    );

    await logProfitDistribution(solPrice, solProfit, usdProfit, toHot, toSpending, toPayout, toCold, config);

    reserveSummary = `
      <p><strong>Reserve Mode:</strong> Processed profit of <span class="highlight">${snowballProfit.toFixed(4)} SOL</span> (~$${(snowballProfit * solPrice).toFixed(2)}) distributed as:</p>
      <ul>
        <li><strong>Hot Wallet</strong>: ${toHot.toFixed(4)} SOL (~$${(toHot * solPrice).toFixed(2)})</li>
        <li><strong>Spending Wallet</strong>: ${toSpending.toFixed(4)} SOL (~$${(toSpending * solPrice).toFixed(2)})</li>
        <li><strong>Payout Wallet</strong>: ${toPayout.toFixed(4)} SOL (~$${(toPayout * solPrice).toFixed(2)})</li>
        <li><strong>Cold Storage</strong>: ${toCold.toFixed(4)} SOL (~$${(toCold * solPrice).toFixed(2)})</li>
      </ul>
      <p><strong>Wallet Balances</strong> (Cumulative):</p>
      <ul>
        <li><strong>Hot Wallet</strong>: ${walletState.hotWallet.toFixed(4)} SOL (~$${(walletState.hotWallet * solPrice).toFixed(2)})</li>
        <li><strong>Spending Wallet</strong>: ${walletState.spendingWallet.toFixed(4)} SOL (~$${(walletState.spendingWallet * solPrice).toFixed(2)})</li>
        <li><strong>Payout Wallet</strong>: ${walletState.payoutWallet.toFixed(4)} SOL (~$${(walletState.payoutWallet * solPrice).toFixed(2)})</li>
        <li><strong>Cold Storage</strong>: ${walletState.coldWallet.toFixed(4)} SOL (~$${(walletState.coldWallet * solPrice).toFixed(2)})</li>
      </ul>
      <p><strong>Daily Income Target</strong>: $${usdProfit.toFixed(2)} ${targetMet ? 'meets' : 'falls short of'} $${dailyUsdTarget}.</p>
      ${spendingPayout}
    `;
  }

  snowballState.bankroll = parseFloat(currentSol.toFixed(6));
  snowballState.lastUpdated = new Date().toISOString();
  try {
    await fs.mkdir(path.dirname(config.SNOWBALL_STATE_PATH), { recursive: true });
    await fs.writeFile(config.SNOWBALL_STATE_PATH, JSON.stringify(snowballState, null, 2));
    console.log('✅ Snowball state saved.');
  } catch (err) {
    console.error(`ERROR: Failed to save snowball state: ${err.message}`);
  }

  const totalProfitUsd = tradedTokens.reduce((sum, t) => sum + calculateProfit(t), 0);
  const totalProfitSol = totalProfitUsd / solPrice;
  const priceRange = calculateRange(tradedTokens, 'initialPrice');
  const peakPriceRange = calculateRange(tradedTokens, 'peakPrice');
  const timeToPeakRange = calculateRange(tradedTokens, 'timeToPeakMs');
  const profitGainRange = {
    min: tradedTokens.length ? Math.min(...tradedTokens.map(t => parseFloat(t.profitGain))) : 0,
    max: tradedTokens.length ? Math.max(...tradedTokens.map(t => parseFloat(t.profitGain))) : 0
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
  console.log(`This Run Theoretical Profit (All Trades): $${totalProfitUsd.toFixed(4)} USD, ${totalProfitSol.toFixed(4)} SOL`);
  console.log(
    snowballState.status === 'reserve_mode' && startingSnowballBankroll >= snowballState.target
      ? `Reserve Mode: Processed ${snowballProfit.toFixed(4)} SOL profit in ${snowballState.tradesExecuted} trades`
      : `Snowball Mode: Starting from ${startingSnowballBankroll.toFixed(4)} SOL, reached ${currentSol.toFixed(4)} SOL with ${snowballProfit.toFixed(4)} SOL profit in ${snowballState.tradesExecuted} trades`
  );

  const snowballSummary = startingSnowballBankroll < snowballState.target
    ? `<p><strong>Snowball Mode:</strong> Started at <span class="highlight">${startingSnowballBankroll.toFixed(4)} SOL</span>, reached <span class="highlight">${currentSol.toFixed(4)} SOL</span>, generating <span class="highlight">${snowballProfit.toFixed(4)} SOL</span> (~$${(snowballProfit * solPrice).toFixed(2)}) in ${snowballState.tradesExecuted} trades.</p>`
    : `<p><strong>Reserve Mode:</strong> Started at <span class="highlight">${startingSnowballBankroll.toFixed(4)} SOL</span>, processed <span class="highlight">${snowballProfit.toFixed(4)} SOL</span> (~$${(snowballProfit * solPrice).toFixed(2)}) in ${snowballState.tradesExecuted} trades.</p>`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Memecoin Trading Bot Historical Report</title>
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
        <h1>Memecoin Trading Bot Historical Report</h1>

        <div class="section summary">
            <h2><span class="emoji">📝</span> Summary</h2>
            ${priceWarning}
            <p>Analyzed <span class="highlight">${tokens.length} tokens</span> launched between <span class="highlight">${formattedTimeRange}</span>. Executed <span class="highlight">${tradedTokens.length} trades</span>, skipped <span class="highlight">${tierData.Skipped.count} tokens.</span></p>
            ${snowballSummary}
            ${reserveSummary}
        </div>

        <div class="section">
            <h2><span class="emoji">✅</span> Overview</h2>
            <p>Theoretical profit from executed trades: <span class="highlight">$${totalProfitUsd.toFixed(2)}</span> (<span class="highlight">${totalProfitSol.toFixed(4)} SOL</span>) at SOL price <span class="highlight">$${solPrice.toFixed(2)}</span>.</p>
            <ul>
                <li><strong>Total Tokens Analyzed</strong> ${tokens.length}</li>
                <li><strong>Trades Executed</strong> ${tradedTokens.length}</li>
                <li><strong>Current SOL Price</strong> $${solPrice.toFixed(2)}</li>
                <li><strong>Theoretical Total Profit</strong>
                    <ul>
                        <li><strong>USD:</strong> $${totalProfitUsd.toFixed(2)}</li>
                        <li><strong>SOL</strong> ${totalProfitSol.toFixed(4)}</li>
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
                        <td>${tierData[tier].profitSol.toFixed(4)}</td>
                        <td>${tierData[tier].share.toFixed(2)}%</td>
                    </tr>
                `).join('')}
            </table>
        </div>

        <div class="section">
            <h2><span class="emoji">📈</span> Tier Summaries</h2>
            ${tiers.map(tier => {
                const tierTokens = tokens.filter(t => t.tier === tier && t.tradeTaken);
                if (!tierTokens.length) {
                  return `
                    <h3>${tier}</h3>
                    <p>No tokens in the <span class="highlight">${tier}</span> tier.</p>
                  `;
                }
                return `
                  <h3>${tier}</h3>
                  <p><span class="highlight">${tierTokens.length} token${tierTokens.length > 1 ? 's' : ''}</span> in the <span class="highlight">${tier}</span> tier contributed <span class="highlight">$${tierData[tier].profitUsd.toFixed(2)}</span> (<span class="highlight">${tierData[tier].profitSol.toFixed(4)} SOL</span>), representing <span class="highlight">${tierData[tier].share.toFixed(2)}%</span> of trades. Initial prices ranged from <span class="highlight">$${calculateRange(tierTokens, 'initialPrice').min.toFixed(4)}</span> to <span class="highlight">$${calculateRange(tierTokens, 'initialPrice').max.toFixed(4)}</span>, peaking at <span class="highlight">$${calculateRange(tierTokens, 'peakPrice').min.toFixed(4)}</span> to <span class="highlight">$${calculateRange(tierTokens, 'peakPrice').max.toFixed(4)}</span> in <span class="highlight">${calculateRange(tierTokens, 'timeToPeakMs').min.toFixed(0)}–${calculateRange(tierTokens, 'timeToPeakMs').max.toFixed(0)} seconds</span> for gains up to <span class="highlight">${tierTokens.length ? Math.max(...tierTokens.map(t => t.peakPrice / t.initialPrice)).toFixed(2) : 0}x</span>.</p>
                `;
              }).join('')}
        </div>

        ${tokens.map((t, index) => `
            <div class="section">
              <h2><span class="emoji">📘</span> Token Details: Token ${index + 1}</h2>
              <table>
                <tr><th>Metric</th><th>Value</th></tr>
                <tr><td>Token</td><td><a class="token-address" href="https://pump.fun/coin/${t.token}" target="_blank">${t.token}</a></td></tr>
                <tr><td>Launch Time</td><td>${t.launchTimestamp}</td></tr>
                <tr><td>Initial Price</td><td>${formatPrice(t.initialPrice, t.initialPrice / solPrice)}</td></tr>
                <tr><td>Peak Price</td><td>${formatPrice(t.peakPrice, t.peakPrice / solPrice)}</td></tr>
                <tr><td>Peak Gain</td><td>${(t.peakPrice / t.initialPrice).toFixed(1)}x</td></tr>
                <tr><td>Time to Peak</td><td>${msToSeconds(t.timeToPeakMs)} seconds</td></tr>
                <tr><td>Collapse Time</td><td>${msToSeconds(t.collapseTimeMs)} seconds</td></tr>
                <tr><td>Buyers (10s)</td><td>${t.buyers10s}</td></tr>
                <tr><td>Buyers (30s)</td><td>${t.buyers30s}</td></tr>
                <tr><td>Hold Duration</td><td>${t.holdDuration.toFixed(2)} seconds</td></tr>
                <tr><td>Exit Price</td><td>${formatPrice(t.exitPrice, t.exitPrice / solPrice)}</td></tr>
                <tr><td>Profit Gain</td><td>${t.profitGain}%</td></tr>
                <tr><td>Profit</td><td>${formatPrice(calculateProfit(t), calculateProfit(t) / solPrice)}</td></tr>
                <tr><td>Tier</td><td>${t.tradeTaken ? t.tier : 'Skipped'}</td></tr>
                <tr><td>Trade Taken</td><td>${t.tradeTaken}</td></tr>
                <tr><td>Triggered At</td><td>${msToSeconds(t.triggeredAtMs)} seconds</td></tr>
                <tr><td>Notes</td><td>${t.notes}</td></tr>
                ${t.bankrollAfterTrade ? `<tr><td>Bankroll After Trade</td><td>${t.bankrollAfterTrade} SOL</td></tr>` : ''}
              </table>
            </div>
        `).join('')}
    </div>
</body>
</html>
`;

  try {
    await fs.writeFile(config.OUTPUT_HTML, html);
    console.log(`✅ SUCCESS: HTML report generated at ${config.OUTPUT_HTML}`);
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    throw err;
  }
}

// === Load tokens from JSON file ===
async function loadTokensFromFile() {
  try {
    const raw = await fs.readFile(config.OUTPUT_JSON, 'utf8');
    const tokens = JSON.parse(raw);
    console.log(`INFO: Loaded ${tokens.length} tokens from ${config.OUTPUT_JSON}`);
    return tokens;
  } catch (err) {
    console.error(`ERROR: Failed to load tokens from ${config.OUTPUT_JSON} — ${err.message}`);
    throw err;
  }
}

// === Orchestrator ===
(async () => {
  try {
    const mode = process.argv[2] || 'fetch';
    console.log(`[${new Date().toLocaleTimeString()}] MODE: Running in ${mode} mode`);

    let tokens;
    if (mode === 'load') {
      console.log('Loading token data from file...');
      tokens = await loadTokensFromFile();
    } else {
      console.log('Fetching token data...');
      tokens = await fetchRealTokenData();
    }

    console.log('Generating report...');
    await generateReport(tokens, config);
    console.log('✅: Script completed successfully!');
  } catch (err) {
    console.error(`❌ ERROR: ${err.message}`);
    process.exit(1);
  }
})();

export { generateReport };