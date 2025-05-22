// livePumpDetection.js
import { WebSocket } from 'ws';
import dotenv from 'dotenv';
dotenv.config();

// Extract API key from RPC_ENDPOINT
const rpcUrl = process.env.RPC_ENDPOINT;
const apiKey = rpcUrl.match(/api-key=([^&]+)/)?.[1];

if (!apiKey) {
  console.error('❌ API key not found in RPC_ENDPOINT');
  process.exit(1);
}

const PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const WEBSOCKET_URL = `wss://api.mainnet.helius-rpc.com/?api-key=${apiKey}`;

// Optional: import your trade logic
// import { simulateTrade } from './simulateTrade.js';

console.log('📡 Connecting to Solana WebSocket...');

const ws = new WebSocket(WEBSOCKET_URL);

ws.on('open', () => {
  console.log('✅ WebSocket connected. Subscribing to Pump.fun logs...');

  ws.send(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'logsSubscribe',
    params: [
      { mentions: [PROGRAM_ID] },
      { commitment: 'confirmed' }
    ]
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());

  if (msg.method === 'logsNotification') {
    const logs = msg.params.result.value.logs;
    const signature = msg.params.result.value.signature;

    const isCreate = logs.some(log => log.includes('Create'));
    if (isCreate) {
      console.log(`🚀 New Token Launch Detected!`);
      console.log(`🔗 https://solscan.io/tx/${signature}`);
      console.log(`📤 Logs:`, logs);

      // TODO: simulate trade
      // simulateTrade(signature);
    }
  }
});

ws.on('close', () => console.log('❌ WebSocket disconnected.'));
ws.on('error', (err) => console.error('❗ WebSocket error:', err));
