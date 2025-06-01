
// scalperBot.js
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

import getSolPrice from './getSOLPrice.js';
import fetchRecentMints from './utils/fetchRecentMints.js';
import { getTokenPrice, getBuyerStats } from './utils.js';
import { generateScalperReport } from './utils/reporting.js';

dotenv.config();

console.log('🚀 Starting Scalper Bot...');

const REPORT_PATH = './runs/scalper_report.json';
const TRADE_FEE_SOL = 0.0001;
const REQUIRED_PROFITABLE_TRADES = 1;

let seenMints = new Set();
let totalScanned = 0;
let profitableTrades = 0;
let skippedTokens = 0;

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

(async () => {
  const solPrice = await getSolPrice();
  console.log(`💰 SOL Price: $${solPrice} USD`);

  const results = [];

  while (profitableTrades < REQUIRED_PROFITABLE_TRADES) {
    console.log('📦 Fetching recent tokens...');
    const tokens = await fetchRecentMints();
    const newTokens = tokens.filter(t => !seenMints.has(t.mint));
    const names = newTokens.map(t => t.name || 'Unnamed').join(', ');
    console.log(`🧠 Raw tokens fetched: ${names}`);
    console.log(`🔍 Analyzing ${newTokens.length} new tokens...`);

    for (const token of newTokens) {
      const { mint, name } = token;
      seenMints.add(mint);

      const price = await getTokenPrice(mint);
      const buyers = await getBuyerStats(mint);

      if (!price || !buyers) {
        skippedTokens++;
        continue; // Skip logging completely
      }

      const gainFactor = buyers.recentGainFactor || 1.02;
      const netGain = gainFactor - 1 - 0.01; // Simulate slippage/fees
      const gainSOL = price * netGain;

      const entry = {
        name,
        mint,
        gainFactor: gainFactor.toFixed(2),
        gainSOL: gainSOL.toFixed(6),
        profitable: gainSOL > TRADE_FEE_SOL
      };

      results.push(entry);
      totalScanned++;

      if (entry.profitable) {
        profitableTrades++;
        console.log(`📈 Profit #${profitableTrades} – Token ${name} made ${gainSOL.toFixed(6)} SOL`);
      }

      if (profitableTrades >= REQUIRED_PROFITABLE_TRADES) break;
    }

    if (profitableTrades >= REQUIRED_PROFITABLE_TRADES) break;

    console.log('⏳ Cooldown for 30s...');
    await delay(30000);
  }

  fs.writeFileSync(REPORT_PATH, JSON.stringify(results, null, 2));
  console.log(`📊 Tokens scanned: ${totalScanned}, Skipped: ${skippedTokens}, Profitable: ${profitableTrades}`);
  console.log('📄 Report saved:', REPORT_PATH);
})();
