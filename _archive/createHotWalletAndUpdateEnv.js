
import { Keypair, Connection, LAMPORTS_PER_SOL, clusterApiUrl } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';

const ENV_PATH = path.resolve('.env');
const BACKUP_PATH = path.resolve('.env.bak');

(async () => {
  // Step 1: Generate wallet
  const keypair = Keypair.generate();
  const publicKey = keypair.publicKey.toBase58();
  const privateKeyArray = Array.from(keypair.secretKey);

  console.log('✅ New Hot Wallet Generated');
  console.log('Public Key:', publicKey);

  // Step 2: Fund wallet with 0.05 SOL (Devnet)
  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
  const airdropSig = await connection.requestAirdrop(keypair.publicKey, 0.05 * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(airdropSig, 'confirmed');
  console.log('💸 0.05 SOL Airdropped to new wallet (Devnet)');

  // Step 3: Backup original .env
  fs.copyFileSync(ENV_PATH, BACKUP_PATH);
  const envLines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');

  let newEnv = [];
  let archivedAddress = '';
  let archivedPrivateKey = '';

  for (let line of envLines) {
    if (line.startsWith('HOT_WALLET_ADDRESS=')) {
      archivedAddress = line.split('=')[1];
      newEnv.push('HOT_WALLET_ADDRESS=' + publicKey);
    } else if (line.startsWith('WALLET_PRIVATE_KEY=')) {
      archivedPrivateKey = line.split('=')[1];
      newEnv.push('WALLET_PRIVATE_KEY=' + privateKeyArray.join(','));
    } else if (line.startsWith('ARCHIVED_WALLET_2_ADDRESS=')) {
      newEnv.push('ARCHIVED_WALLET_2_ADDRESS=' + archivedAddress);
    } else if (line.startsWith('ARCHIVED_WALLET_2_PRIVATE_KEY=')) {
      newEnv.push('ARCHIVED_WALLET_2_PRIVATE_KEY=' + archivedPrivateKey);
    } else {
      newEnv.push(line);
    }
  }

  fs.writeFileSync(ENV_PATH, newEnv.join('\n'), 'utf8');
  console.log('📝 .env updated and .env.bak created');
})();
