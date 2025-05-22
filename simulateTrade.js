// simulateTrade.js
import { Connection, PublicKey } from '@solana/web3.js';
import fs from 'fs';
import dotenv from 'dotenv';
import { getBuyers10s } from './getBuyers10s.js';
import { logTrade, logError } from './logger.js';

dotenv.config();

// 🌐 RPC rotation support
const RPC_ENDPOINTS = [
  process.env.RPC_ENDPOINT_1 || process.env.RPC_ENDPOINT,
  process.env.RPC_ENDPOINT_2,
  process.env.RPC_ENDPOINT_3
].filter(Boolean);

const connections = RPC_ENDPOINTS.map(endpoint => new Connection(endpoint, 'confirmed'));
let currentIndex = 0;
const getNextConnection = () => {
  const conn = connections[currentIndex];
  currentIndex = (currentIndex + 1) % connections.length;
  return conn;
};

// ⏳ Jitter + retry
function delay(ms) {
  return new Promise(res => setTimeout(res, ms));
}

function jitter(min = 1000, max = 3000) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function withBackoff(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      await delay(jitter(1000, 2000));
    }
  }
}

// 💾 Load wallet state
const walletStatePath = './walletState.json';
let walletState = {};

try {
  walletState = JSON.parse(fs.readFileSync(walletStatePath, 'utf-8'));
} catch {
  walletState = {};
}

walletState.balance = walletState.balance ?? 0;
walletState.trades = Array.isArray(walletState.trades) ? walletState.trades : [];

const BUY_AMOUNT = 0.05;
const SLIPPAGE = 0.03;
const FEE = 0.0001;

// 🚀 Simulate trade
export async function simulateTrade(signature) {
  try {
    await delay(jitter(1200, 2500)); // global throttle

    const { buyers10s, mint } = await getBuyers10s(signature);

    const connection = getNextConnection();
    const tx = await withBackoff(() =>
      connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0 })
    );
    if (!tx) return logError(`❌ Transaction not found: ${signature}`);

    const creator = tx.transaction.message.accountKeys[0].pubkey.toString();

    const entryPrice = 1.0;
    let exitPrice = entryPrice;
    let outcome = '❌ Skipped';
    let profit = 0;

    if (buyers10s >= 5) {
      const moonshot = Math.random() < 0.23;
      const partial = !moonshot && Math.random() < 0.5;

      if (moonshot) {
        outcome = '🚀 Moonshot';
        exitPrice = entryPrice * 3.0;
        profit = BUY_AMOUNT * 2.0;
      } else if (partial) {
        outcome = '✅ Partial Exit';
        exitPrice = entryPrice * 1.5;
        profit = BUY_AMOUNT * 0.5;
      } else {
        outcome = '⚠️ Weak Momentum';
        exitPrice = entryPrice * 0.9;
        profit = BUY_AMOUNT * -0.1;
      }

      profit -= FEE;
      profit -= BUY_AMOUNT * SLIPPAGE;
    }

    const now = new Date().toISOString();
    walletState.balance += profit;
    walletState.trades.push({
      timestamp: now,
      signature,
      mint,
      creator,
      buyers10s,
      outcome,
      entryPrice,
      exitPrice,
      profit: profit.toFixed(4)
    });

    fs.writeFileSync(walletStatePath, JSON.stringify(walletState, null, 2));
    logTrade(`${outcome} | ${mint} | ${profit.toFixed(4)} SOL | ${buyers10s} buyers | https://solscan.io/tx/${signature}`);
  } catch (err) {
    logError(`Simulation failed for ${signature}`, err);
  }
}
