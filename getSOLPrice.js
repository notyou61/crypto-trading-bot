
import fetch from 'node-fetch';

let cachedPrice = null;
let lastFetchTime = 0;
const CACHE_DURATION = 600000;
const RETRY_DELAY = 20000;
const MAX_RETRIES = 3;

async function fetchCoinGeckoPrice() {
  try {
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    if (!response.ok) throw new Error(`CoinGecko failed with status ${response.status}`);
    const data = await response.json();
    return data.solana.usd;
  } catch (err) {
    console.error(`CoinGecko error: ${err.message}`);
    return null;
  }
}

async function fetchBirdeyePrice() {
  try {
    const response = await fetch('https://public-api.birdeye.so/public/price?address=So11111111111111111111111111111111111111112', {
      headers: { 'X-API-KEY': process.env.BIRDEYE_API_KEY || 'a15eb8c70f8643a39b325c26910e5c90' },
    });
    if (!response.ok) throw new Error(`Birdeye request failed with status ${response.status}`);
    const data = await response.json();
    return data.data.value;
  } catch (err) {
    console.error(`Birdeye error: ${err.message}`);
    return null;
  }
}

export default async function getSolPrice() {
  const now = Date.now();
  if (cachedPrice && now - lastFetchTime < CACHE_DURATION) {
    return cachedPrice;
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const price = await fetchCoinGeckoPrice();
    if (price) {
      cachedPrice = price;
      lastFetchTime = now;
      return cachedPrice;
    }
    if (attempt < MAX_RETRIES) {
      console.warn(`CoinGecko retry (${attempt}/${MAX_RETRIES}) after ${RETRY_DELAY}ms...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    }
  }

  console.warn('CoinGecko failed, falling back to Birdeye API');
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const price = await fetchBirdeyePrice();
    if (price) {
      cachedPrice = price;
      lastFetchTime = now;
      return cachedPrice;
    }
    if (attempt < MAX_RETRIES) {
      console.warn(`Birdeye retry (${attempt}/${MAX_RETRIES}) after ${RETRY_DELAY}ms...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    }
  }

  console.error('Failed to fetch SOL price from all sources');
  return null;
}
