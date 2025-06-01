// utils.js
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;

// Fetch recent token mints (placeholder logic)
export async function fetchNewTokens(limit = 10) {
  try {
    const res = await axios.get(`https://api.helius.xyz/v0/addresses?api-key=${HELIUS_API_KEY}&limit=${limit}`);
    return res.data || [];
  } catch (err) {
    console.error('❌ Failed to fetch new tokens:', err.message);
    return [];
  }
}

// Fetch buyer stats from Helius logs (placeholder logic)
export async function getBuyerStats(mint) {
  try {
    const url = `https://api.helius.xyz/v0/token-metadata?mint=${mint}&api-key=${HELIUS_API_KEY}`;
    const res = await axios.get(url);
    const holders = res.data?.numberOfHolders || 0;
    return { holders };
  } catch (err) {
    console.error(`❌ Buyer stats error for ${mint}:`, err.message);
    return { holders: 0 };
  }
}

// Get token price from Dexscreener
export async function getTokenPrice(tokenAddress) {
  try {
    const { data } = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
    const price = parseFloat(data.pairs?.[0]?.priceUsd || 0);
    return price;
  } catch (err) {
    console.error(`❌ Price fetch failed for ${tokenAddress}:`, err.message);
    return 0;
  }
}
