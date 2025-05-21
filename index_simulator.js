// index_simulator.js
// Sandbox simulation for real-time trade logic (mock trading only)

import fs from 'fs';
import nodemailer from 'nodemailer';
import { Connection, PublicKey } from '@solana/web3.js';

const RPC_ENDPOINT = 'https://api.mainnet-beta.solana.com';
const PUMPFUN_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const connection = new Connection(RPC_ENDPOINT, 'confirmed');

const walletFile = './sandbox/wallet_state.json';
const tradeLogFile = './sandbox/simulated_trades.csv';
const cronLogFile = './sandbox/cron_log.csv';

let tradeCounter = 0;
let lastEmailSent = Date.now();

// Load wallet state from file
function loadWallet() {
  const raw = fs.readFileSync(walletFile);
  return JSON.parse(raw);
}

// Save wallet state to file
function saveWallet(wallet) {
  wallet.lastUpdate = new Date().toISOString();
  fs.writeFileSync(walletFile, JSON.stringify(wallet, null, 2));
}

// Append trade result to CSV
function logTrade(trade) {
  const header = !fs.existsSync(tradeLogFile);
  const line = `${trade.time},${trade.token},${trade.action},${trade.profitSOL}\n`;
  if (header) fs.writeFileSync(tradeLogFile, 'Time,Token,Action,Profit_SOL\n');
  fs.appendFileSync(tradeLogFile, line);
}

// Send summary email
async function sendEmail(wallet, profit) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });

  const msg = `Simulation Report\n\nProfit This Hour: ${profit.toFixed(4)} SOL\n\nHot Wallet: ${wallet.hotWallet.balanceSOL} SOL\nPayout Wallet: ${wallet.payoutWallet.balanceSOL} SOL\nCold Storage: ${wallet.coldStorage.balanceSOL} SOL`;

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: wallet.emailNotification,
    subject: 'Hourly Simulation Report: Solana Bot',
    text: msg
  });
}

// Simulate trade logic
function simulateTrade(wallet) {
  const accepted = Math.random() > 0.5;
  if (!accepted) return null;

  const isMoonshot = Math.random() < 0.25;
  const profit = isMoonshot ? 0.2 : 0.05;

  wallet.hotWallet.balanceSOL += profit;

  const action = isMoonshot ? 'Moonshot' : 'Partial Exit';
  const trade = {
    time: new Date().toISOString(),
    token: 'FakeToken_' + tradeCounter++,
    action,
    profitSOL: profit
  };

  logTrade(trade);
  return profit;
}

// Simulate hourly fund rebalancing
function hourlyCron(wallet, hourProfit) {
  const toPayout = hourProfit * 0.5;
  const toCold = hourProfit * 0.25;

  wallet.hotWallet.balanceSOL -= (toPayout + toCold);
  wallet.payoutWallet.balanceSOL += toPayout;
  wallet.coldStorage.balanceSOL += toCold;

  fs.appendFileSync(cronLogFile,
    `${new Date().toISOString()},${toPayout.toFixed(4)},${toCold.toFixed(4)}\n`
  );
}

// Main Loop
(async () => {
  console.log('Starting sandbox simulation...');
  let wallet = loadWallet();
  let hourlyProfit = 0;

  setInterval(async () => {
    const profit = simulateTrade(wallet);
    if (profit) hourlyProfit += profit;

    // Hourly check
    const now = Date.now();
    if (now - lastEmailSent >= 3600000) {
      hourlyCron(wallet, hourlyProfit);
      await sendEmail(wallet, hourlyProfit);
      saveWallet(wallet);
      hourlyProfit = 0;
      lastEmailSent = now;
    }
  }, 10000); // Every 10s simulate a token
})();
