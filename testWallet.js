// testWallet.js
import { Keypair } from '@solana/web3.js';

const wallet = Keypair.generate();
console.log('Public Key:', wallet.publicKey.toBase58());
console.log('Private Key (Uint8Array):', wallet.secretKey);
