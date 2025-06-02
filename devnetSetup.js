// devnetSetup.js
// 🎯 Initializes Devnet testing environment for conservative sniper bot
// 📅 Author: Steve Skye | 2025-06-02

import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const DEVNET = 'https://api.devnet.solana.com';
const connection = new Connection(DEVNET, 'confirmed');

const WALLET_PATH = './.devnet_wallet.json';

// 🔐 Create or load wallet
function getOrCreateWallet() {
  if (fs.existsSync(WALLET_PATH)) {
    const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync(WALLET_PATH)));
    return Keypair.fromSecretKey(secretKey);
  } else {
    const wallet = Keypair.generate();
    fs.writeFileSync(WALLET_PATH, JSON.stringify(Array.from(wallet.secretKey)));
    console.log('✅ Devnet wallet created:', wallet.publicKey.toBase58());
    return wallet;
  }
}

// 💸 Airdrop SOL to wallet
async function airdropSol(wallet) {
  const balance = await connection.getBalance(wallet.publicKey);
  if (balance < 1 * LAMPORTS_PER_SOL) {
    console.log('💸 Requesting 2 SOL from Devnet faucet...');
    const sig = await connection.requestAirdrop(wallet.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig);
    console.log('✅ Airdrop complete.');
  } else {
    console.log('💰 Wallet already funded. Balance:', balance / LAMPORTS_PER_SOL, 'SOL');
  }
}

// 🚀 Init Devnet setup
(async () => {
  const wallet = getOrCreateWallet();
  await airdropSol(wallet);
})();
