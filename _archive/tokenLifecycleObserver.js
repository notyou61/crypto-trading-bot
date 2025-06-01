// tokenLifecycleObserver.js
import fs from 'fs';
import path from 'path';
import { getTokenPrice } from './utils/getTokenPrice.js';
import { getBuyerStats } from './utils/getBuyerStats.js';
import fetchRecentMints from './utils/fetchRecentMints.js';
import { generateLifecycleReport } from './utils/generateLifecycleReport.js';

const POLL_INTERVAL_MS = 5000;
const MAX_TOKENS = 10;
const STALL_TIMEOUT_MS = 30000;
const MAX_RETRIES = 12; // 12 tries * 5s = 60s retry window
const DATA_PATH = './runs/token_lifecycle_data.json';
const WSOL_ADDRESS = 'So11111111111111111111111111111111111111112';

const tracked = new Map();
const completed = new Map();
let isReportGenerated = false; // Track if report has been generated

function writeJSONSnapshot() {
  const snapshot = Array.from(tracked.entries()).map(([mint, data]) => ({
    token: mint,
    ...data,
  }));
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(snapshot, null, 2));
}
//
// ✅ Manual token injection (used while Helius NFT API is broken)
if (tracked.size === 0 && !isReportGenerated) {
  const now = Date.now();
  const realToken = 'ADbM4fsotzMwsaP3CdZTFWnBoLgjPsUuiZUJnqPYpump'; // your token
  const signature = null; // optional: replace with a real 88-char signature if you have it

  tracked.set(realToken, {
    signature,
    priceHistory: [],
    buyerHistory: [],
    lastBuyerCount: 0,
    lastUpdate: now,
    isRugged: false,
    retryCount: 0
  });

  console.log(`🎯 Manually added token to tracker: ${realToken}`);
}


async function trackTokens() {
  if (tracked.size >= MAX_TOKENS || isReportGenerated) return;

  const recent = await fetchRecentMints(25);
  for (const { tokenAddress, signature } of recent) {
    // Skip invalid or WSOL addresses
    if (
      !tokenAddress ||
      tokenAddress === WSOL_ADDRESS ||
      tracked.has(tokenAddress) ||
      completed.has(tokenAddress)
    ) {
      continue;
    }
    if (tracked.size >= MAX_TOKENS) break;

    console.log(`🔍 Tracking token: ${tokenAddress}`);
    tracked.set(tokenAddress, {
      signature,
      priceHistory: [],
      buyerHistory: [],
      lastBuyerCount: 0,
      lastUpdate: Date.now(),
      isRugged: false,
      retryCount: 0,
    });
  }
}

async function pollTrackedTokens() {
  if (isReportGenerated) return;

  const now = Date.now();
  for (const [token, data] of tracked.entries()) {
    try {
      const price = await getTokenPrice(token);
      const buyers = await getBuyerStats(data.signature);

      if (price === null && data.retryCount < MAX_RETRIES) {
        data.retryCount += 1;
        console.log(`🔄 Retrying price fetch for ${token} (${data.retryCount}/${MAX_RETRIES})`);
        continue;
      }

      data.priceHistory.push({ t: now, price: price ?? 0 });
      data.buyerHistory.push({ t: now, count: buyers?.buyerCount ?? 0 });

      if (buyers?.buyerCount && buyers.buyerCount !== data.lastBuyerCount) {
        data.lastUpdate = now;
        data.lastBuyerCount = buyers.buyerCount;
      }

      const priceIsRugged = price === null || price <= 0.0000001;
      const stalled = now - data.lastUpdate > STALL_TIMEOUT_MS;

      if ((priceIsRugged && data.retryCount >= MAX_RETRIES) || stalled) {
        console.log(`💀 Token ${token} considered rugged.`);
        data.isRugged = true;
        tracked.delete(token);
        completed.set(token, data);
      }
    } catch (e) {
      console.warn(`⚠️ Error polling ${token}: ${e.message}`);
      if (data.retryCount < MAX_RETRIES) {
        data.retryCount += 1;
        console.log(`🔄 Retrying ${token} (${data.retryCount}/${MAX_RETRIES})`);
      } else {
        console.log(`💀 Token ${token} considered rugged due to repeated errors.`);
        data.isRugged = true;
        tracked.delete(token);
        completed.set(token, data);
      }
    }
  }
  writeJSONSnapshot();
}

function reportIfDone(interval) {
  if (completed.size >= MAX_TOKENS && !isReportGenerated) {
    isReportGenerated = true; // Prevent multiple reports
    const validEntries = Array.from(completed.entries()).map(([token, data]) => [
      token,
      {
        ...data,
        priceHistory: data.priceHistory || [],
        buyerHistory: data.buyerHistory || [],
      },
    ]);
    generateLifecycleReport(validEntries)
      .then((html) => {
        const reportPath = './runs/token_lifecycle_report.html';
        fs.writeFileSync(reportPath, html);
        console.log(`📝 Lifecycle report ready: ${reportPath}`);
        clearInterval(interval); // Stop the interval
      })
      .catch((e) => {
        console.error(`❌ Error generating report: ${e.message}`);
      });
    return true;
  }
  return false;
}

function startObserver() {
  console.log(`🚀 Token Lifecycle Observer Started (Tracking up to ${MAX_TOKENS} tokens)`);
  const interval = setInterval(async () => {
    await trackTokens();
    await pollTrackedTokens();
    reportIfDone(interval);
  }, POLL_INTERVAL_MS);
}

startObserver();