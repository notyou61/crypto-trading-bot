// testKey.js
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

const privateKey = 'aqHPJdm7bggg3BxzdayaGK3dycWTGjJbYRqWGBV9YJmzSmmvab35W7U2ZKqurQaHtPytvCR8dBerYSVA9p3k2G8';

try {
  const decodedKey = bs58.decode(privateKey);
  if (decodedKey.length !== 64) {
    console.error(`Invalid key size: ${decodedKey.length} bytes. Expected 64 bytes for Solana keypair.`);
    process.exit(1);
  }
  const keypair = Keypair.fromSecretKey(decodedKey);
  console.log('Public Key:', keypair.publicKey.toBase58());
  console.log('Key is valid!');
} catch (err) {
  console.error('Error:', err.message);
  if (err.message.includes('Non-base58 character')) {
    console.error('Invalid base58 characters.');
  } else if (err.message.includes('bad secret key size')) {
    console.error('Key size incorrect. Generating new keypair for paper trading.');
    const newKeypair = Keypair.generate();
    console.log('New Public Key:', newKeypair.publicKey.toBase58());
    console.log('New Private Key:', bs58.encode(newKeypair.secretKey));
  }
}