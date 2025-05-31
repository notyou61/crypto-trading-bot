// profitabilitySniperFinal.js
import fs from 'fs';
import dotenv from 'dotenv';
import { Keypair, PublicKey } from '@solana/web3.js';
import { getSolPrice } from './getSolPrice.js';
import { fetchNewTokens, getBuyerStats, getTokenPrice } from './utils.js';
import bs58 from 'bs58';
import { generateAfterActionReport } from './generateAfterActionReport.js';

dotenv.config();

const HOLD_LIMIT_MS = parseInt(process.env.MAX_HOLD_TIME || '120000');
const ENTRY_TRIGGER = 1.05;
const EXIT_TARGET = 2.0;
const PARTIAL_EXIT = 1.3;
const TRADE_SIZE = parseFloat(process.env.TRADE_SIZE || '0.05');
const SLIPPAGE = parseFloat(process.env.SLIPPAGE || '0.03');
const TX_FEE = parseFloat(process.env.TX_FEE || '0.0001');
const WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY;
const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

let simulatedBalance = 0.5;
let totalProfit = 0;
let tradeCount = [];
let tradeHistory = [];

try {
  const keypair = Keypair.fromSecretKey(bs58.decode(WALLET_PRIVATE_KEY));
  console.log(`🚀 Sniper Bot Started (Paper Trading)`);
  console.log(`Wallet: ${keypair.publicKey.toString()}`);
  console.log(`💰 Simulated Balance: ${simulatedBalance.toFixed(4)} SOL`);
} catch (e) {
  console.error(`❌ Invalid private key: ${e.message}`);
  process.exit(1);
}

let previousTokens = new Set();

async function checkBalance(amount) {
  if (simulatedBalance < amount + TX_FEE) {
    throw new Error(`Insufficient simulated balance: ${simulatedBalance.toFixed(4)} SOL`);
  }
  return simulatedBalance;
}

async function simulateSwap(inputMint, outputMint, amount, price, tokenAddress) {
  const solPrice = await getSolPrice();
  const tokensBought = (amount / price) * (1 - SLIPPAGE);
  const cost = amount + TX_FEE;
  simulatedBalance -= cost;
  console.log(`💸 Simulated Buy: ${amount} SOL -> ${tokensBought.toFixed(2)} tokens (${outputMint.toString()}) at $${price.toFixed(6)}`);
  console.log(`💰 New Balance: ${simulatedBalance.toFixed(4)} SOL`);
  return { tokensBought, cost };
}

async function simulateSell(tokenMint, tokens, price, metadata) {
  const solPrice = await getSolPrice();
  const solReceived = tokens * price * (1 - SLIPPAGE);
  const profit = solReceived - TRADE_SIZE - TX_FEE * 2;
  simulatedBalance += solReceived - TX_FEE;
  totalProfit += profit;
  tradeCount.push(profit);
  console.log(`💸 Simulated Sell: ${tokens.toFixed(2)} tokens (${tokenMint.toString()}) -> ${solReceived.toFixed(4)} SOL at $${price.toFixed(6)}`);
  console.log(`📊 Profit: ${profit.toFixed(4)} SOL | Total Profit: ${totalProfit.toFixed(4)} SOL | Trades: ${tradeCount.length}`);
  console.log(`💰 New Balance: ${simulatedBalance.toFixed(4)} SOL`);

  tradeHistory.push({
    ...metadata,
    exitPrice: price,
    solReceived: solReceived,
    profit: profit
  });

  return profit;
}

async function monitorTokens() {
  while (true) {
    try {
      await checkBalance(TRADE_SIZE);
      const tokens = await fetchNewTokens();
      const evaluationPromises = [];
      for (const token of tokens) {
        const { address, signature, createdAt } = token;
        if (previousTokens.has(address)) continue;

        previousTokens.add(address);
        console.log(`🆕 [${new Date().toLocaleTimeString()}] Detected New Token: ${address}`);

        evaluationPromises.push(
          new Promise((resolve) => {
            setTimeout(() => {
              evaluateToken(token).then(resolve).catch(resolve);
            }, 15000);
          })
        );
      }
      await Promise.all(evaluationPromises);
    } catch (e) {
      console.error(`⚠️ Monitor error: ${e.message}`);
    }
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}

async function evaluateToken(token) {
  const { address, signature, createdAt } = token;
  console.debug(`Evaluating token: ${address}`);
  try {
    const initialPrice = await getTokenPrice(address, createdAt);
    const priceNow = await getTokenPrice(address, Date.now());
    if (initialPrice === 0 || priceNow === 0) {
      console.warn(`⚠️ Skipping ${address}: Invalid price (initial: $${initialPrice}, now: $${priceNow})`);
      return;
    }
    const buyers = await getBuyerStats(signature);
    console.log(`🔍 ${address} | Price: $${priceNow.toFixed(6)} | Buyers: ${buyers.buyerCount} | Volume: ${buyers.volume.toFixed(2)} SOL`);
    const gain = priceNow / initialPrice || 1;
    console.log(`📈 [${new Date().toLocaleTimeString()}] ${address} Price Check: +${((gain - 1) * 100).toFixed(2)}%`);

    if (gain >= ENTRY_TRIGGER && buyers.buyerCount >= 5 && buyers.volume >= 0.3) {
      console.log(`✅ Entry Trigger Met: Simulating buy for ${address} at $${priceNow.toFixed(6)}`);
      const { tokensBought } = await simulateSwap(SOL_MINT, new PublicKey(address), TRADE_SIZE, priceNow, address);
      monitorPosition(token, priceNow, tokensBought);
    } else {
      console.log(`❌ Entry Rejected: ${address} | Gain: ${((gain - 1) * 100).toFixed(2)}% | Buyers: ${buyers.buyerCount} | Volume: ${buyers.volume.toFixed(2)} SOL`);
    }
  } catch (e) {
    console.error(`⚠️ Evaluation error for ${address}: ${e.message}`);
  }
}

async function monitorPosition(token, entryPrice, tokensBought) {
  const { address } = token;
  const entryTime = Date.now();

  const metadata = {
    token: address,
    entryTime,
    entryPrice,
    tokensBought
  };

  const interval = setInterval(async () => {
    try {
      const currentPrice = await getTokenPrice(address, Date.now());
      if (currentPrice === 0) {
        console.warn(`⚠️ Invalid price for ${address}: $${currentPrice}, continuing hold`);
        return;
      }
      const elapsed = Date.now() - entryTime;
      const gain = currentPrice / entryPrice || 1;
      console.log(`⏱ Holding ${address}... Gain: +${((gain - 1) * 100).toFixed(2)}% | Elapsed: ${(elapsed / 1000).toFixed(0)}s`);

      if (gain >= EXIT_TARGET && elapsed >= 60000) {
        console.log(`💰 Moonshot Exit for ${address} at $${currentPrice.toFixed(6)} (+${((gain - 1) * 100).toFixed(2)}%)`);
        await simulateSell(new PublicKey(address), tokensBought, currentPrice, { ...metadata, exitType: 'Moonshot', duration: elapsed });
        clearInterval(interval);
      } else if (gain >= PARTIAL_EXIT || elapsed >= HOLD_LIMIT_MS) {
        console.log(`🔁 Partial/Fallback Exit for ${address} at $${currentPrice.toFixed(6)} (+${((gain - 1) * 100).toFixed(2)}%)`);
        await simulateSell(new PublicKey(address), tokensBought, currentPrice, { ...metadata, exitType: 'Partial/Fallback', duration: elapsed });
        clearInterval(interval);
      }
    } catch (e) {
      console.error(`⚠️ Monitor error for ${address}: ${e.message}`);
    }
  }, 5000);
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
});

(async () => {
  await monitorTokens();
  await generateAfterActionReport(tradeHistory);
})();
