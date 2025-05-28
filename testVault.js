// testVault.js
import { Connection, PublicKey } from '@solana/web3.js';

const connection = new Connection('https://mainnet.helius-rpc.com/?api-key=82256758-538e-4d1a-a827-39d8a176c540', 'confirmed');
async function testVault() {
  const mint = '9NWUanJ4kJZJQiSfDL6bznAFF46QpPKmJ6fadhpMpump';
  const programPubkey = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
  const mintPubkey = new PublicKey(mint);
  const [vaultPda] = await PublicKey.findProgramAddress(
    [Buffer.from('bonding-curve'), mintPubkey.toBuffer()],
    programPubkey
  );
  const balance = await connection.getBalance(vaultPda);
  console.log(`Vault for ${mint}: ${vaultPda.toString()}, Balance: ${balance / 1_000_000_000} SOL`);
}
testVault().catch(err => console.error(err));