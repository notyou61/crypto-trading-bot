import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

export default async function fetchRecentMints(limit = 50) {
  if (!HELIUS_API_KEY) {
    console.error('❌ Missing HELIUS_API_KEY in .env');
    return [];
  }

  const url = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

  const signaturesPayload = {
    jsonrpc: '2.0',
    id: 'new-mints-signatures',
    method: 'getSignaturesForAddress',
    params: [
      PUMP_FUN_PROGRAM,
      {
        limit,
        commitment: 'confirmed',
        before: null,
      },
    ],
  };

  try {
    const signaturesResponse = await axios.post(url, signaturesPayload);
    if (!signaturesResponse.data?.result) {
      console.error('❌ Unexpected API response format for signatures:', signaturesResponse.data);
      return [];
    }

    const signatures = signaturesResponse.data.result;
    console.log(`✅ Found ${signatures.length} transaction signatures`);

    const tokens = [];
    const seenMints = new Set();

    for (const sig of signatures) {
      const txPayload = {
        jsonrpc: '2.0',
        id: `tx-${sig.signature}`,
        method: 'getTransaction',
        params: [
          sig.signature,
          {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0,
            encoding: 'jsonParsed',
          },
        ],
      };

      try {
        const txResponse = await axios.post(url, txPayload);
        if (!txResponse.data?.result) {
          console.warn(`⚠️ No data for transaction ${sig.signature}`);
          continue;
        }

        const tx = txResponse.data.result;
        const innerInstructions = tx.meta?.innerInstructions || [];
        innerInstructions
          .flatMap(i => i.instructions)
          .forEach(ix => console.log('Instruction:', {
            programId: ix.programId,
            type: ix.parsed?.type,
            parsed: ix.parsed,
          }));

        const mintIx = innerInstructions
          .flatMap(i => i.instructions)
          .find(ix => {
            const isSPLToken = ix.programId === 'TokenkegQfeZyiNwAJbNbGK7Qx' &&
              (ix.parsed?.type === 'mintTo' ||
               ix.parsed?.type === 'initializeMint' ||
               ix.parsed?.type === 'initializeAccount3' ||
               ix.parsed?.type === 'getAccountDataSize');
            const isPumpFun = ix.programId === PUMP_FUN_PROGRAM;
            return isSPLToken || isPumpFun;
          });

        if (mintIx) {
          const tokenAddress = mintIx.parsed?.info?.mint || findMintInAccounts(tx);
          const isCreation = tx.meta?.logMessages?.some(log => log.includes('Instruction: Create') && log.includes(PUMP_FUN_PROGRAM));
          if (tokenAddress && !seenMints.has(tokenAddress) && isCreation) {
            seenMints.add(tokenAddress);
            tokens.push({
              tokenAddress,
              signature: sig.signature,
              createdAt: tx.blockTime ? tx.blockTime * 1000 : Date.now(),
            });
          }
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (txError) {
        console.warn(`⚠️ Failed to fetch transaction ${sig.signature}: ${txError.message}`);
      }
    }

    console.log(`✅ Found ${tokens.length} new mints`);
    return tokens;
  } catch (err) {
    console.error('❌ Failed to fetch recent mints:', err.message);
    if (err.response) {
      console.error('Response data:', err.response.data);
      console.error('Response status:', err.response.status);
    }
    return [];
  }
}

function findMintInAccounts(tx) {
  const accounts = tx.transaction.message.accountKeys || [];
  return accounts.find(acc => acc.signer === false && acc.writable && acc.pubkey !== PUMP_FUN_PROGRAM)?.pubkey;
}