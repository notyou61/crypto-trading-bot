// testRpc.js
import { Connection } from '@solana/web3.js';

async function testRpc() {
  const endpoints = [
    'https://mainnet.helius-rpc.com/?api-key=82256758-538e-4d1a-a827-39d8a176c540',
    'https://chaotic-rough-gadget.solana-mainnet.quiknode.pro/b96d9392b154ac9decb744e59a4274d3dde0d8fc'
  ];
  for (const endpoint of endpoints) {
    try {
      const conn = new Connection(endpoint, 'confirmed');
      const version = await conn.getVersion();
      console.log(`Connected to ${endpoint}: ${version['solana-core']}`);
    } catch (err) {
      console.error(`Failed ${endpoint}: ${err.message}`);
    }
  }
}
testRpc().catch(console.error);