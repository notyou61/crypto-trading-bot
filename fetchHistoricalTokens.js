// fetchHistoricalTokens.js
import fs from 'fs';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const OUTPUT_FILE = './runs/historical_snapshot_with_signature.json';
const MAX_PAGES = 20;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchPumpFunLaunches() {
  const seenMints = new Set();
  const resultList = [];
  let before = undefined;
  let page = 0;

  fs.mkdirSync('./runs', { recursive: true });

  while (page < MAX_PAGES) {
    const url = `https://api.helius.xyz/v0/addresses/${PUMP_FUN_PROGRAM}/transactions?api-key=${HELIUS_API_KEY}`;
    const params = before ? { before } : {};

    try {
      const response = await axios.get(url, { params });
      const txs = response.data;

      if (!Array.isArray(txs) || txs.length === 0) break;

      console.log(`📄 Page ${page + 1}: Scanning ${txs.length} txs`);
      for (const tx of txs) {
        const pumpTransfer = tx.tokenTransfers?.find(t => t.mint?.endsWith('pump') && !seenMints.has(t.mint));
        if (!pumpTransfer) continue;

        seenMints.add(pumpTransfer.mint);

        const tokenInfo = {
          token: pumpTransfer.mint.split('pump')[0],
          launchTimestamp: new Date(tx.timestamp * 1000).toISOString(),
          initialPrice: parseFloat((Math.random() * 0.0001 + 0.00001).toFixed(8)),
          peakPrice: parseFloat((Math.random() * 0.002 + 0.0005).toFixed(8)),
          timeToPeakMs: Math.floor(Math.random() * 60000),
          collapseTimeMs: Math.floor(Math.random() * 120000),
          buyers10s: Math.floor(Math.random() * 20),
          buyers30s: Math.floor(Math.random() * 40),
          holdDuration: Math.floor(Math.random() * 120),
          exitPrice: parseFloat((Math.random() * 0.002).toFixed(8)),
          profitGain: parseFloat((Math.random() * 30).toFixed(2)),
          tier: ["Pulse", "Moonshot", "Supermoon", "Nova", "Black Hole"][Math.floor(Math.random() * 5)],
          tradeTaken: true,
          triggeredAtMs: Math.floor(Math.random() * 30000),
          notes: "Profit-in-place triggered simulation for testing."
        };

        resultList.push(tokenInfo);
      }

      before = txs[txs.length - 1].signature;
      page++;
      await delay(1000);
    } catch (err) {
      console.error(`❌ Error on page ${page + 1}:`, err.response?.data || err.message);
      break;
    }
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(resultList, null, 2));
  console.log(`✅ Saved ${resultList.length} records to ${OUTPUT_FILE}`);
}

await fetchPumpFunLaunches();
