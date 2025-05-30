import { mnemonicToSeedSync } from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

// 🔒 Replace with your actual 12-word Phantom seed phrase
const mnemonic = 'word1 word2 word3 ... word12';

const seed = mnemonicToSeedSync(mnemonic);
const derived = derivePath("m/44'/501'/0'/0'", seed).key;
const keypair = Keypair.fromSeed(derived);

console.log('✅ Public Key:', keypair.publicKey.toBase58());
console.log('✅ Private Key (base58):', bs58.encode(keypair.secretKey));
