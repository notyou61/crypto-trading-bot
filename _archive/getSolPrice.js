// getSolPrice.js
import axios from 'axios';

export async function getSolPrice() {
  try {
    const response = await axios.get(
      'https://api.dexscreener.com/latest/dex/pairs/solana/So11111111111111111111111111111111111111112'
    );
    const price = parseFloat(response.data?.pair?.priceUsd);
    return isNaN(price) ? null : price;
  } catch (err) {
    console.error('❌ Failed to fetch SOL price:', err.message);
    return null;
  }
}
