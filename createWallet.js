// createWallet.js
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import fs from 'fs';

const keypair = Keypair.generate();

const publicKey = keypair.publicKey.toBase58();
const secretKey = bs58.encode(keypair.secretKey);

// Output to console
console.log('\n✅ Hot Wallet Keypair Generated:\n');
console.log(`🔐 WALLET_PRIVATE_KEY=${secretKey}`);
console.log(`🔥 HOT_WALLET_ADDRESS=${publicKey}\n`);

// Optional: Write to file
fs.writeFileSync('./hot_wallet.json', JSON.stringify({
  publicKey,
  secretKeyArray: Array.from(keypair.secretKey),
}, null, 2));

console.log('📁 Keypair also saved to hot_wallet.json');
