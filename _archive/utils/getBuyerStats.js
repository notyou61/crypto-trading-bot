// utils/getBuyerStats.js
import axios from 'axios';

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const HELIUS_API_URL = 'https://api.helius.xyz/v0/transactions';
const MAX_RETRIES = 3;

async function getBuyerStats(signature) {
  if (!signature || typeof signature !== 'string' || signature.length !== 88) {
    console.warn(`Invalid signature: ${signature}`);
    return { buyerCount: 0 };
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await axios.get(`${HELIUS_API_URL}?api-key=${HELIUS_API_KEY}`, {
        params: {
          signatures: [signature],
        },
      });

      const tx = response.data[0];
      if (!tx) {
        console.warn(`No transaction data for signature: ${signature}`);
        return { buyerCount: 0 };
      }

      // Simplified: Count unique accounts in token transfer instructions
      const accounts = new Set(
        tx.accountData?.filter((acc) => acc.account !== WSOL_ADDRESS).map((acc) => acc.account) || []
      );
      return { buyerCount: accounts.size };
    } catch (error) {
      console.error(
        `Helius buyer fetch failed for ${signature} (attempt ${attempt}/${MAX_RETRIES}):`,
        error.response?.data?.message || error.message
      );
      if (attempt === MAX_RETRIES) {
        return { buyerCount: 0 };
      }
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1s before retry
    }
  }
}

export { getBuyerStats };