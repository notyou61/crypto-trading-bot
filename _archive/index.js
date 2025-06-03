import dotenv from 'dotenv';
import bs58 from 'bs58';
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { fetchRecentMints } from './utils/fetchRecentMints.js';
import { getTokenPrice } from './utils/getTokenPrice.js';
import { executeSwap } from './utils/executeSwap.js';
import {
  addToken,
  getWaitingTokens,
  markAsPriced,
  incrementRetry,
  expireOldTokens,
  trackedTokens,
} from './utils/trackedTokens.js';

dotenv.config();

///////////////////////////////////////
// ⚙️ CONFIGURATION
///////////////////////////////////////

const TEST_MODE = process.env.TEST_MODE === 'true';
const RPC_URL = TEST_MODE
  ? process.env.RPC_ENDPOINT_DEVNET || 'https://api.devnet.solana.com'
  : process.env.RPC_ENDPOINT_MAINNET || 'https://mainnet.helius-rpc.com/?api-key=YOUR_HELIUS_API_KEY';

if (!RPC_URL) throw new Error('❌ RPC endpoint not configured');

const connection = new Connection(RPC_URL, 'confirmed');
const wallet = Keypair.fromSecretKey(
  bs58.decode(process.env.HOT_WALLET_PRIVATE_KEY)
);

const JUPITER_QUOTE_API = 'https://quote-api.jup.ag/v6/quote';
const TRADE_SIZE_SOL = parseFloat(process.env.TRADE_SIZE) || 0.05;
const SLIPPAGE_BPS = (parseFloat(process.env.SLIPPAGE) * 10000) || 300;
const ENTRY_TRIGGER = parseFloat(process.env.ENTRY_TRIGGER) || 1.05;
const PRICE_RETRY_INTERVAL = 15000; // 15 seconds

console.log(TEST_MODE
  ? '🚧 Running in TEST MODE — no real trades will be executed.'
  : '🚀 Running in LIVE MODE — executing real trades.');

///////////////////////////////////////
// 🔁 MAIN LOOP
///////////////////////////////////////

async function mainLoop() {
  try {
    const recentMints = await fetchRecentMints();
    let newMintsAdded = 0;

    for (const mint of recentMints) {
      if (!trackedTokens.some(t => t.mint === mint)) {
        addToken(mint, 'Unknown');
        newMintsAdded++;
      }
    }

    if (newMintsAdded > 0) {
      console.log(`[${new Date().toISOString()}] 🎯 New token(s) detected: ${newMintsAdded}`);
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] fetchRecentMints failed: ${err.message}`);
  }

  const tokensToCheck = getWaitingTokens();

  for (const token of tokensToCheck) {
    const age = Date.now() - token.createdAt;
    if (age < PRICE_RETRY_INTERVAL) continue;

    try {
      const price = await getTokenPrice(token.mint, JUPITER_QUOTE_API, SLIPPAGE_BPS, TRADE_SIZE_SOL);
      if (price !== null) {
        console.log(`[${new Date().toISOString()}] ✅ ${token.mint} is tradeable at ~$${price.toFixed(6)}`);
        markAsPriced(token.mint, price);

        if (!token.initialPrice) {
          token.initialPrice = price;
        }

        if (price >= token.initialPrice * ENTRY_TRIGGER) {
          await executeSwap(
            token.mint,
            price,
            TRADE_SIZE_SOL * LAMPORTS_PER_SOL,
            SLIPPAGE_BPS,
            wallet,
            TEST_MODE,
            connection
          );
        }
      } else {
        incrementRetry(token.mint);
      }
    } catch (err) {
      console.error(`[${new Date().toISOString()}] ⚠️ Price fetch failed for ${token.mint}: ${err.message}`);
      incrementRetry(token.mint);
    }
  }

  expireOldTokens();
  setTimeout(mainLoop, 5000); // Poll every 5s
}

mainLoop();
