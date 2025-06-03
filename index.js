// index.js
import dotenv from 'dotenv';
import { Connection, clusterApiUrl, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { loadWallet } from './utils/loadWallet.js';
import fs from 'fs';
// Load environment variables
dotenv.config();

///////////////////////////////////////
// ⚙️ CONFIGURATION
///////////////////////////////////////

const TEST_MODE = process.env.TEST_MODE === 'true';
const RPC_URL = TEST_MODE
  ? clusterApiUrl('devnet')
  : process.env.RPC_ENDPOINT_MAINNET;

if (!RPC_URL) throw new Error('RPC endpoint not configured');

const connection = new Connection(RPC_URL, 'confirmed');

///////////////////////////////////////
// 🔐 LOAD DEVNET WALLET
///////////////////////////////////////

const wallet = loadWallet(TEST_MODE);
console.log(TEST_MODE ? '🔐 Devnet wallet loaded' : '🔐 Mainnet wallet loaded');

///////////////////////////////////////
// 🚀 ENTRY POINT
///////////////////////////////////////

async function startBot() {
  console.log(TEST_MODE
    ? '🚧 Running in TEST MODE — no real trades will be executed.'
    : '🚀 Running in LIVE MODE — real trades will be executed.');

  // Placeholder: Load strategy, track tokens, etc.
  console.log('🔁 Bot is initialized and ready to track tokens...');
}
// Start the bot
startBot();