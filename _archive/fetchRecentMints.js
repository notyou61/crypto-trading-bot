import axios from 'axios';
import dotenv from 'dotenv';
import { PublicKey } from '@solana/web3.js';

dotenv.config();

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const CREATOR = process.env.PUMPFUN_CREATOR_MAINNET;
const DEBUG = true;

export async function fetchRecentMints() {
  if (!HELIUS_API_KEY) {
    console.error('[fetchRecentMints] Error: HELIUS_API_KEY is not set');
    return [];
  }
  if (!CREATOR) {
    console.error('[fetchRecentMints] Error: PUMPFUN_CREATOR_MAINNET is not set');
    return [];
  }
  try {
    new PublicKey(CREATOR);
  } catch (err) {
    console.error(`[fetchRecentMints] Invalid creator address: ${CREATOR} - ${err.message}`);
    return [];
  }

  const url = `https://rpc.helius.xyz/?api-key=${HELIUS_API_KEY}`;
  let page = 1;
  let allMints = [];

  while (true) {
    if (DEBUG) {
      console.debug(`🔍 Fetching recent mints via getAssetsByCreator for ${CREATOR}, page ${page}`);
    }

    try {
      const res = await axios.post(url, {
        jsonrpc: '2.0',
        id: 1,
        method: 'getAssetsByCreator',
        params: {
          creatorAddress: CREATOR,
          onlyVerified: false,
          page,
          limit: 10,
        },
      });

      const items = res.data?.result?.items || [];
      if (!items.length) {
        break; // No more items
      }

      const mintAddresses = items
        .map(asset => asset.id)
        .filter(id => typeof id === 'string' && id.length === 44);

      allMints = [...allMints, ...mintAddresses];

      if (items.length < 10) {
        break; // Less than limit, likely no more pages
      }
      page++;
    } catch (err) {
      const status = err.response?.status || 'Unknown';
      const msg = err.response?.statusText || err.message;
      const body = err.response?.data || 'No additional error details';
      console.error(`[fetchRecentMints] Failed to fetch page ${page}: ${status} ${msg} - Details: ${JSON.stringify(body)}`);
      break;
    }
  }

  if (!allMints.length) {
    console.warn(`⚠️ No tokens found for creator ${CREATOR}`);
    return [];
  }

  console.log(`🎯 Found ${allMints.length} token mints`);
  return allMints;
}