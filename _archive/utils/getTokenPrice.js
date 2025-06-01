// utils/getTokenPrice.js
import axios from 'axios';

/**
 * Fetches the real-time token price in SOL using Dexscreener API.
 * @param {string} tokenAddress - Token mint address.
 * @returns {Promise<number|null>} - Price in SOL or null if not found.
 */
export async function getTokenPrice(tokenAddress) {
  try {
    if (!tokenAddress || typeof tokenAddress !== 'string') {
      console.warn(`⚠️ Invalid token address: ${tokenAddress}`);
      return null;
    }

    const url = `https://api.dexscreener.com/latest/dex/pairs/solana/${tokenAddress}`;
    const res = await axios.get(url);
    const pairData = res?.data?.pair;

    if (!pairData || !pairData.priceInSol) {
      console.warn(`❌ Token not yet listed on Dexscreener: ${tokenAddress.slice(0, 8)}...`);
      return null;
    }

    const price = parseFloat(pairData.priceInSol);
    if (isNaN(price)) {
      console.warn(`⚠️ Invalid price received from Dexscreener for ${tokenAddress.slice(0, 8)}...`);
      return null;
    }

    console.log(`📈 Real price for ${tokenAddress.slice(0, 8)}...: ${price.toFixed(6)} SOL`);
    return price;
  } catch (err) {
    console.error(`❌ Error fetching price from Dexscreener for ${tokenAddress.slice(0, 8)}...: ${err.message}`);
    return null;
  }
}
