import axios from 'axios';
import { PublicKey } from '@solana/web3.js';

export async function getTokenPrice(mint) {
  if (!mint || typeof mint !== 'string' || mint.length !== 44) {
    throw new Error(`Invalid mint address: ${mint}`);
  }

  try {
    const pubKey = new PublicKey(mint); // Validates the key
    const url = `https://api.dexscreener.io/latest/dex/pairs/solana/${mint}`;
    const res = await axios.get(url);
    const price = res.data?.pair?.priceUsd;
    if (!price) throw new Error('Price not found');
    return parseFloat(price);
  } catch (err) {
    console.error(`[getTokenPrice] Error: ${err.message}`);
    throw err;
  }
}