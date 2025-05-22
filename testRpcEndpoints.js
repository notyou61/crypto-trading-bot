// testRpcEndpoints.js
import { Connection } from '@solana/web3.js';

const endpoints = [
  'https://mainnet.helius-rpc.com/?api-key=ab9e6b89-a906-4855-8416-3eabb2201580',
  'https://rpc.ankr.com/solana_devnet/7319ffdc3b58b1ad046851a340aa4ea0c66b5ec2449a8d3f0845bf9d2a1c7ee7',
  'https://chaotic-rough-gadget.solana-mainnet.quiknode.pro/b96d9392b154ac9decb744e59a4274d3dde0d8fc',
];

const testConnection = async (url) => {
  try {
    const connection = new Connection(url, 'confirmed');
    const slot = await connection.getSlot();
    console.log(`✅ SUCCESS: ${url} | Current Slot: ${slot}`);
  } catch (err) {
    console.error(`❌ FAIL: ${url} | ${err.message}`);
  }
};

(async () => {
  for (const url of endpoints) {
    await testConnection(url);
  }
})();
