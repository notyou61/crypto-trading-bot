// fetchRecentMints.js
import axios from 'axios';

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8YfFf96FqyC5s1rPQRYu7XkPj6jG'; // Fixed address

export default async function fetchRecentMints(limit = 30) {
  const url = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
  const now = Date.now();
  const tenMinutesAgo = now - 10 * 60 * 1000;

  const body = {
    jsonrpc: '2.0',
    id: 'my-id',
    method: 'getSignaturesForAddress',
    params: [
      PUMP_FUN_PROGRAM,
      {
        limit,
        before: null,
        until: null,
      }
    ]
  };

  try {
    const response = await axios.post(url, body);
    const signatures = response.data.result || [];

    const tokens = signatures.map((tx) => {
      const tokenAddress = tx.signature;
      const name = tx.meta?.postTokenBalances?.[0]?.tokenMetadata?.name || 'Unnamed';

      return {
        tokenAddress,
        name
      };
    });

    return tokens;
  } catch (error) {
    console.error('Failed to fetch recent mints:', error.message);
    return [];
  }
}