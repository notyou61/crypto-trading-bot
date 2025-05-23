// scaffoldHistoricalAnalyzer.js
import fs from 'fs';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const OUTPUT_FILE = './runs/historical_tokens.json';
const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

const TARGET_LAUNCHES = 1000;
const MAX_REQUESTS = 100;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchTokenLaunches() {
  const url = `https://api.helius.xyz/v0/addresses/${PUMP_FUN_PROGRAM}/transactions?api-key=${HELIUS_API_KEY}`;
  let allLaunches = [];
  let seenMints = new Set();
  let before = null;
  let requestCount = 0;
  let minTimestamp = null;
  let maxTimestamp = null;

  const startTime = new Date();
  console.log(`🚀 Start Time: ${startTime.toISOString()}`);

  try {
    while (seenMints.size < TARGET_LAUNCHES && requestCount < MAX_REQUESTS) {
      const params = before ? { before } : {};
      const res = await axios.get(url, { params });
      const transactions = res.data;

      for (const tx of transactions) {
        const isNewPump = tx?.tokenTransfers?.some(t =>
          t.mint?.endsWith('pump') && !seenMints.has(t.mint)
        );

        if (isNewPump) {
          tx.tokenTransfers.forEach(t => {
            if (t.mint?.endsWith('pump')) {
              seenMints.add(t.mint);
            }
          });

          allLaunches.push(tx);

          if (tx.timestamp) {
            if (!minTimestamp || tx.timestamp < minTimestamp) minTimestamp = tx.timestamp;
            if (!maxTimestamp || tx.timestamp > maxTimestamp) maxTimestamp = tx.timestamp;
          }

          if (allLaunches.length % 100 === 0) {
            console.log(`🔁 Progress: ${allLaunches.length} total launches`);
          }

          if (seenMints.size >= TARGET_LAUNCHES) break;
        }
      }

      before = transactions.length > 0 ? transactions[transactions.length - 1].signature : null;
      requestCount++;
      if (before && seenMints.size < TARGET_LAUNCHES) await delay(1000);
    }

    const endTime = new Date();
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allLaunches, null, 2));

    console.log(`✅ Done. ${allLaunches.length} token launches saved.`);
    console.log(`🎯 Unique Mints Collected: ${seenMints.size}`);
    if (minTimestamp && maxTimestamp) {
      console.log(`⏱️ Time Window: ${new Date(minTimestamp * 1000).toISOString()} → ${new Date(maxTimestamp * 1000).toISOString()}`);
    }
    console.log(`🕓 End Time: ${endTime.toISOString()}`);
  } catch (err) {
    console.error('❌ Failed to fetch transactions:', err.response?.data || err.message);
  }
}

fetchTokenLaunches();
