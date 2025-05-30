// utils.js
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const PUMP_FUN_PROGRAM = process.env.PUMP_FUN_PROGRAM || '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const HELIUS_ENDPOINT = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const RETRY_DELAY = 5000;
const MAX_RETRIES = 5;

let seen = new Set();
let priceCache = new Map();
let buyerCache = new Map();
const CACHE_DURATION = 60000; // 1 minute

async function withRetry(fn, maxRetries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (e.response?.status === 429 && attempt < maxRetries) {
        console.warn(`Rate limit (429), retrying (${attempt}/${maxRetries}) after ${RETRY_DELAY}ms...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      } else {
        throw e;
      }
    }
  }
}

export async function fetchNewTokens() {
  const body = {
    jsonrpc: '2.0',
    id: 'fetch-tokens',
    method: 'getSignaturesForAddress',
    params: [PUMP_FUN_PROGRAM, { limit: 20 }],
  };

  try {
    const res = await withRetry(() => axios.post(HELIUS_ENDPOINT, body));
    const signatures = res.data.result || [];

    const newTokens = [];
    for (const tx of signatures) {
      const sig = tx.signature;
      if (seen.has(sig)) continue;
      seen.add(sig);

      const txDetails = await getTransactionDetails(sig);
      const mint = txDetails?.meta?.postTokenBalances?.find(
        (b) => b.owner !== PUMP_FUN_PROGRAM && b.mint !== SOL_MINT && b.mint.length === 44 && b.mint.endsWith('pump')
      )?.mint;
      if (mint) {
        newTokens.push({
          address: mint,
          signature: sig,
          createdAt: Date.now(),
        });
      } else {
        console.debug(`Skipped invalid mint: ${mint || 'none'} for sig ${sig}`);
      }
    }
    console.log(`Fetched ${newTokens.length} valid tokens`);
    return newTokens;
  } catch (e) {
    console.error('❌ Helius fetch failed:', e.message);
    return [];
  }
}

async function getTransactionDetails(signature) {
  try {
    const res = await withRetry(() =>
      axios.post(HELIUS_ENDPOINT, {
        jsonrpc: '2.0',
        id: 'getTx',
        method: 'getTransaction',
        params: [signature, { maxSupportedTransactionVersion: 0 }],
      })
    );
    return res.data.result;
  } catch (e) {
    console.error(`⚠️ Tx details failed for ${signature}: ${e.message}`);
    return null;
  }
}

export async function getTokenPrice(mint, timestamp) {
  console.debug(`Fetching price for mint: ${mint}`);
  if (mint === SOL_MINT || !mint.endsWith('pump')) {
    console.debug(`Skipping price fetch for invalid mint: ${mint}`);
    return 0;
  }
  const cacheKey = `${mint}-${Math.floor(timestamp / CACHE_DURATION)}`;
  if (priceCache.has(cacheKey)) {
    console.debug(`Cache hit for ${mint}: $${priceCache.get(cacheKey).toFixed(6)}`);
    return priceCache.get(cacheKey);
  }

  try {
    const res = await withRetry(() =>
      axios.get(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, { timeout: 5000 })
    );
    const pair = res.data?.pairs?.[0];
    const price = parseFloat(pair?.priceUsd) || 0;
    console.debug(`DEXScreener response for ${mint}: ${JSON.stringify(res.data.pairs?.slice(0, 1))}`);
    if (price > 0) {
      console.debug(`DEXScreener price for ${mint}: $${price.toFixed(6)}`);
      priceCache.set(cacheKey, price);
      return price;
    } else {
      console.warn(`⚠️ No valid price from DEXScreener for ${mint}, pair: ${JSON.stringify(pair)}`);
      return 0;
    }
  } catch (e) {
    console.warn(`⚠️ DEXScreener failed for ${mint}: ${e.message}`);
    return 0;
  }
}

export async function getBuyerStats(signature) {
  const cacheKey = signature;
  if (buyerCache.has(cacheKey)) {
    return buyerCache.get(cacheKey);
  }

  try {
    const res = await withRetry(() =>
      axios.post(HELIUS_ENDPOINT, {
        jsonrpc: '2.0',
        id: 'getSig',
        method: 'getTransaction',
        params: [signature, { maxSupportedTransactionVersion: 0 }],
      })
    );
    const stats = {
      buyerCount: res?.data?.result?.meta?.logMessages?.length || 0,
      volume: (res?.data?.result?.meta?.postBalances?.[0] || 0) / 1e9,
    };
    buyerCache.set(cacheKey, stats);
    return stats;
  } catch (e) {
    console.error(`⚠️ Buyer stats failed for ${signature}: ${e.message}`);
    return { buyerCount: 0, volume: 0 };
  }
}