// getBuyers10s.js
import { Connection, PublicKey } from '@solana/web3.js';
import dotenv from 'dotenv';
import { logError, logTrade } from './logger.js';

dotenv.config();

// 🔁 Initialize RPC rotation from .env
const RPC_ENDPOINTS = [
  process.env.RPC_ENDPOINT_1,
  process.env.RPC_ENDPOINT_2,
  process.env.RPC_ENDPOINT_3
].filter(Boolean);

const connections = RPC_ENDPOINTS.map(endpoint => new Connection(endpoint, 'confirmed'));
let currentConnectionIndex = 0;
const getNextConnection = () => {
  const conn = connections[currentConnectionIndex];
  currentConnectionIndex = (currentConnectionIndex + 1) % connections.length;
  return conn;
};

const delay = (min = 800, max = 2000) =>
  new Promise(res => setTimeout(res, Math.floor(Math.random() * (max - min + 1) + min)));

// 🧠 Retry with exponential backoff + jitter
async function getWithRetry(fn, retries = 5, baseDelay = 500) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      const jitter = Math.floor(Math.random() * baseDelay);
      const wait = Math.pow(2, i) * baseDelay + jitter;
      await delay(wait, wait + 200);
    }
  }
}

export async function getBuyers10s(launchSig) {
  try {
    await delay();
    const connection = getNextConnection();

    const tx = await getWithRetry(() =>
      connection.getParsedTransaction(launchSig, { maxSupportedTransactionVersion: 0 })
    );
    if (!tx) throw new Error('Launch transaction not found');

    const blockTime = tx.blockTime;
    if (!blockTime) throw new Error('No blockTime in transaction');

    const instructions = tx.transaction.message.instructions;
    const keys = tx.transaction.message.accountKeys;

    let mint = null;
    const mintInstruction = instructions.find(ix => ix.parsed?.type === 'initializeMint');
    if (mintInstruction?.parsed?.info?.mint) {
      mint = mintInstruction.parsed.info.mint;
    }

    if (!mint) {
      const splIx = instructions.find(ix => ix.program === 'spl-token' && ix.parsed?.info?.mint);
      if (splIx?.parsed?.info?.mint) {
        mint = splIx.parsed.info.mint;
      }
    }

    if (!mint) {
      const fallback = keys.find(k => !k.signer && k.writable);
      if (fallback?.pubkey) {
        const raw = fallback.pubkey;
        mint = raw instanceof PublicKey ? raw.toBase58() : raw.toString?.() ?? String(raw);
      } else if (typeof fallback === 'string') {
        mint = fallback;
      }
    }

    if (!mint) throw new Error('Mint address not found');

    const mintPubKey = new PublicKey(mint);

    await delay();
    let sigs = [];
    try {
      sigs = await getWithRetry(() =>
        connection.getSignaturesForAddress(mintPubKey, { limit: 50 })
      );
    } catch (sigErr) {
      logError(`⚠️ Signature fetch failed for ${mint}`, sigErr);
      return { buyers10s: 0, mint };
    }

    const earlySigs = sigs.filter(sig =>
      sig.blockTime && sig.blockTime <= blockTime + 10
    );

    const buyers = new Set();
    let successCount = 0;

    for (const sig of earlySigs) {
      try {
        await delay();
        const buyerTx = await getWithRetry(() =>
          connection.getParsedTransaction(sig.signature, { maxSupportedTransactionVersion: 0 })
        );

        const key = buyerTx?.transaction?.message?.accountKeys?.[0];
        let buyerKey = null;

        if (key?.pubkey) {
          buyerKey = key.pubkey instanceof PublicKey ? key.pubkey.toBase58() : key.pubkey;
        } else if (typeof key === 'string') {
          buyerKey = key;
        }

        if (buyerKey) {
          buyers.add(buyerKey);
          successCount++;
        }
      } catch (innerErr) {
        logError(`❌ Failed parsing buyer key from tx ${sig.signature}`, innerErr);
      }
    }

    logTrade(`🧠 ${successCount}/${earlySigs.length} buyers found for ${mint}`);
    return { buyers10s: buyers.size, mint };
  } catch (err) {
    logError(`getBuyers10s() failed for ${launchSig}`, err);
    throw err;
  }
}
