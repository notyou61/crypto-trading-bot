
import axios from 'axios';

export async function getTokenPrice(mint) {
  try {
    const url = `https://api.dexscreener.com/latest/dex/pairs/solana/${mint}`;
    const res = await axios.get(url);
    const price = res.data?.pair?.priceUsd;

    if (!price) console.warn(`⚠️ No price found for ${mint}`);
    return parseFloat(price);
  } catch (err) {
    console.error(`❌ Error in getTokenPrice for ${mint}:`, err.message);
    return null;
  }
}
