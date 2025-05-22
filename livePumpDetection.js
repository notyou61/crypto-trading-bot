// livePumpDetection.js
import WebSocket from 'ws';
import dotenv from 'dotenv';
import fs from 'fs';
import { simulateTrade } from './simulateTrade.js';
dotenv.config();

// Extract API key from .env
const rpcUrl = process.env.RPC_ENDPOINT;
const apiKey = rpcUrl?.match(/api-key=([^&]+)/)?.[1];
if (!apiKey) process.exit(1);;

const PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const WEBSOCKET_URL = `wss://rpc.helius.xyz/?api-key=${apiKey}`;

const launchQueue = new Set(); // ensure uniqueness
const MAX_QUEUE_SIZE = 20;     // optional cap to prevent memory creep

// Handle WebSocket connection
const ws = new WebSocket(WEBSOCKET_URL);

ws.on('open', () => {
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

ws.on('message', async (data) => {
  try {
    const msg = JSON.parse(data.toString());
    if (msg.method === 'logsNotification') {
      const logs = msg.params.result.value.logs;
      const signature = msg.params.result.value.signature;

      if (logs.some(log => log.includes('Create'))) {
        fs.appendFileSync('launches.log', `${new Date().toISOString()} | ${signature}\n`);
        if (!launchQueue.has(signature) && launchQueue.size < MAX_QUEUE_SIZE) {
          launchQueue.add(signature);
        }
      }
    }
  } catch {
    // Silent failure — do not spam console
  }
});

// 🕒 Process one launch every 3 seconds
setInterval(async () => {
  if (launchQueue.size === 0) return;

  const [sig] = launchQueue; // get the first item
  launchQueue.delete(sig);   // remove it from the queue

  try {
    await simulateTrade(sig); // actual trade simulation is rate-safe
  } catch {
    // simulateTrade will handle internal logging
  }
}, 3000); // adjust interval here
