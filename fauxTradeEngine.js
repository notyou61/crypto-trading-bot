// fauxTradeEngine.js
import fs from 'fs';
import { format } from 'date-fns';
import { sendEmailReport } from './emailReport.js';

const WALLET_FILE = './walletState.json';

// --- Load or Initialize Wallet State ---
let wallet = {
  balance: 0.5,
  totalTrades: 0,
  totalMoonshots: 0,
  totalPartials: 0,
  totalSkipped: 0,
  totalProfit: 0,
  history: []
};

if (fs.existsSync(WALLET_FILE)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(WALLET_FILE, 'utf-8'));
    wallet = {
      balance: loaded.balance ?? 0.5,
      totalTrades: loaded.totalTrades ?? 0,
      totalMoonshots: loaded.totalMoonshots ?? 0,
      totalPartials: loaded.totalPartials ?? 0,
      totalSkipped: loaded.totalSkipped ?? 0,
      totalProfit: loaded.totalProfit ?? 0,
      history: Array.isArray(loaded.history) ? loaded.history : []
    };
  } catch (err) {
    console.error('⚠️ Failed to load wallet. Reinitializing with defaults.');
  }
}

// --- Simulate a Token Launch ---
function simulateTokenLaunch() {
  const buyers10s = Math.floor(Math.random() * 10);
  const buyers30s = Math.floor(Math.random() * 30);
  const priceSpikePct = Math.floor(Math.random() * 300);
  const timeAtPeak = Math.floor(Math.random() * 120);

  const accepted = buyers10s >= 5;
  let result = '❌ Skipped';
  let profit = 0;

  if (accepted) {
    wallet.totalTrades++;
    if (priceSpikePct >= 200 && timeAtPeak >= 60) {
      result = '🚀 Moonshot';
      profit = 0.20;
      wallet.totalMoonshots++;
    } else {
      result = '✅ Partial Exit';
      profit = 0.05;
      wallet.totalPartials++;
    }
    wallet.balance += profit;
    wallet.totalProfit += profit;
  } else {
    wallet.totalSkipped++;
  }

  wallet.history.push({
    timestamp: format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
    buyers10s,
    buyers30s,
    priceSpikePct,
    timeAtPeak,
    result,
    profit
  });
}

// --- Run the Simulation ---
async function runSimulation(batchSize = 18) {
  for (let i = 0; i < batchSize; i++) {
    simulateTokenLaunch();
  }

  fs.writeFileSync(WALLET_FILE, JSON.stringify(wallet, null, 2));
  console.log(`✅ Simulated ${batchSize} trades. Balance: ${wallet.balance.toFixed(2)} SOL`);
  await sendEmailReport(wallet);
}

runSimulation();
