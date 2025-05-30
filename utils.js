// utils.js
import axios from 'axios';
import dotenv from 'dotenv';
import fetchNewTokens from './utils/fetchRecentMints.js'; 
dotenv.config();

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const HELIUS_ENDPOINT = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const CACHE_DURATION = 60000;
const RETRY_DELAY = 3000;
const MAX_RETRIES = 5;

let priceCache = new Map();
let buyerCache = new Map();

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

export { fetchNewTokens }; // ✅ Exporting from new file

export async function getTokenPrice(mint) {
  const now = Date.now();
  if (priceCache.has(mint) && now - priceCache.get(mint).ts < CACHE_DURATION) {
    return priceCache.get(mint).price;
  }
  const url = `https://api.dexscreener.com/latest/dex/pairs/solana/${mint}`;
  try {
    const { data } = await axios.get(url);
    const price = data.pairs?.[0]?.priceUsd || 0;
    priceCache.set(mint, { price, ts: now });
    return parseFloat(price);
  } catch (e) {
    console.error(`Price error for ${mint}: ${e.message}`);
    return 0;
  }
}

export async function getBuyerStats(mint) {
  const now = Date.now();
  if (buyerCache.has(mint) && now - buyerCache.get(mint).ts < CACHE_DURATION) {
    return buyerCache.get(mint).stats;
  }
  const url = `https://api.dexscreener.com/latest/dex/pairs/solana/${mint}`;
  try {
    const { data } = await axios.get(url);
    const stats = data.pairs?.[0]?.txns?.m5 || { buys: 0, sells: 0 };
    buyerCache.set(mint, { stats, ts: now });
    return stats;
  } catch (e) {
    console.error(`Buyer stats error for ${mint}: ${e.message}`);
    return { buys: 0, sells: 0 };
  }
}
