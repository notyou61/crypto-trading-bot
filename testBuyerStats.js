// testBuyerStats.js
import { Connection, PublicKey } from '@solana/web3.js';

const connection = new Connection('https://mainnet.helius-rpc.com/?api-key=82256758-538e-4d1a-a827-39d8a176c540', 'confirmed');
async function testBuyerStats() {
  const mint = '9NWUanJ4kJZJQiSfDL6bznAFF46QpPKmJ6fadhpMpump';
  const startTime = 1745232000000;
  const signatures = await connection.getSignaturesForAddress(new PublicKey(mint), { limit: 100 });
  console.log(`Signatures found: ${signatures.length}`);
  for (const sig of signatures.slice(0, 5)) {
    console.log(`Sig: ${sig.signature}, Time: ${sig.blockTime}`);
  }
}
testBuyerStats().catch(console.error);