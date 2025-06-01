// utils/fetchRecentMints.js
import dotenv from 'dotenv';
dotenv.config();
import axios from 'axios';

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const HELIUS_RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const PUMP_FUN_CREATOR = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const WSOL_ADDRESS = 'So11111111111111111111111111111111111111112';

async function fetchRecentMints(limit = 100) {
  try {
    const sigRes = await axios.post(HELIUS_RPC_URL, {
      jsonrpc: '2.0',
      id: 1,
      method: 'getSignaturesForAddress',
      params: [PUMP_FUN_CREATOR, { limit }],
    });

    const signatures = (sigRes.data.result || []).map((entry) => entry.signature);

    const results = [];
    for (const sig of signatures) {
      try {
        const txRes = await axios.post(HELIUS_RPC_URL, {
          jsonrpc: '2.0',
          id: 1,
          method: 'getTransaction',
          params: [sig, { maxSupportedTransactionVersion: 0 }],
        });

        const instructions = txRes.data.result?.transaction?.message?.instructions || [];
        const innerInstructions = txRes.data.result?.meta?.innerInstructions || [];

        // Try both top-level and inner instructions
        const allInstructions = [...instructions];
        innerInstructions.forEach((ix) => {
          if (Array.isArray(ix.instructions)) allInstructions.push(...ix.instructions);
        });

        const mintIx = allInstructions.find(
          (ix) =>
            ix?.parsed?.type === 'initializeMint' &&
            ix?.parsed?.info?.mint &&
            ix?.parsed?.info?.mint !== WSOL_ADDRESS
        );

        if (mintIx) {
          const tokenAddress = mintIx.parsed.info.mint;
          results.push({ tokenAddress, signature: sig });
        }
      } catch (innerErr) {
        console.warn(`⚠️ Failed to parse transaction ${sig}: ${innerErr.message}`);
      }
    }

    console.log(`🔍 Found ${results.length} new mints`);
    return results;
  } catch (error) {
    console.error(`❌ Failed to fetch recent mints: ${error.message}`);
    if (error.response) {
      console.error(`Helius response: HTTP ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
    }
    return [];
  }
}

export default fetchRecentMints;
