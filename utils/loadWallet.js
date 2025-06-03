// loadWallet.js
import fs from 'fs';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';
import dotenv from 'dotenv';

dotenv.config();

export function loadWallet(testMode = false) {
  if (testMode) {
    const devnetFile = process.env.DEVNET_KEYPAIR_FILE || './wallets/devnet-wallet.json';
    const secret = JSON.parse(fs.readFileSync(devnetFile, 'utf8'));
    return Keypair.fromSecretKey(new Uint8Array(secret));
  } else {
    const base58Key = process.env.HOT_WALLET_PRIVATE_KEY;
    if (!base58Key) throw new Error('Missing HOT_WALLET_PRIVATE_KEY in .env');
    return Keypair.fromSecretKey(bs58.decode(base58Key));
  }
}
