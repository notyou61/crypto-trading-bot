// profitabilityReport6.js
// Full auto sniper bot: Pump.fun token watcher + live buy/sell using Strategy v3

import jupapi from '@jup-ag/api';
const Jupiter = jupapi.default || jupapi.Jupiter;

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import dotenv from 'dotenv';
import { getSolPrice } from './getSOLPrice.js';
import { getVaultAddress, getTokenSupply } from './profitabilityReport5.js';

dotenv.config();

const RPC_ENDPOINT = process.env.RPC_ENDPOINT_1;
const PRIVATE_KEY = process.env.PHANTOM_PRIVATE_KEY;
const TRADE_SIZE = parseFloat(process.env.TRADE_SIZE) || 0.05;
const SLIPPAGE_BPS = Math.round((parseFloat(process.env.SLIPPAGE) || 0.03) * 10000);
const TX_FEE = parseFloat(process.env.TX_FEE) || 0.0001;
const MAX_HOLD_TIME = parseInt(process.env.MAX_HOLD_TIME) || 120000;
const BASE_TOKEN = 'So11111111111111111111111111111111111111112';
const PUMP_FUN_PROGRAM = process.env.PUMP_FUN_PROGRAM;
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;

const wallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
const connection = new Connection(RPC_ENDPOINT, 'confirmed');

async function executeLiveTrade(targetMint) {
  const jupiter = await Jupiter.load({ connection, cluster: 'mainnet-beta', user: wallet });
  const routeMap = await jupiter.getRouteMap();
  if (!routeMap.get(BASE_TOKEN)?.includes(targetMint)) return null;

  const { routesInfos } = await jupiter.computeRoutes({
    inputMint: new PublicKey(BASE_TOKEN),
    outputMint: new PublicKey(targetMint),
    amount: TRADE_SIZE * 1e9,
    slippageBps: SLIPPAGE_BPS,
    onlyDirectRoutes: false,
  });

  if (!routesInfos?.length) return null;
  const { execute } = await jupiter.exchange({ routeInfo: routesInfos[0] });
  const txid = await execute();
  console.log(`✅ BUY: https://solscan.io/tx/${txid}`);
  return txid;
}

async function monitorAndSnipe() {
  console.log('🔄 Sniper bot started...');
  const seen = new Set();

  while (true) {
    try {
      const url = `https://api.helius.xyz/v0/addresses/${PUMP_FUN_PROGRAM}/transactions?api-key=${HELIUS_API_KEY}`;
      const res = await fetch(url);
      const txs = await res.json();

      for (const tx of txs) {
        const t = tx.tokenTransfers?.find(t => t.mint?.endsWith('pump') && !seen.has(t.mint));
        if (!t?.mint) continue;

        const mint = t.mint;
        seen.add(mint);
        const start = tx.timestamp * 1000;
        console.log(`🔍 Found: ${mint}`);

        const vaultAddr = await getVaultAddress(mint);
        const supply = await getTokenSupply(mint);
        if (!vaultAddr || !supply) continue;

        const solPrice = await getSolPrice();
        const vault = await connection.getBalance(new PublicKey(vaultAddr));
        const initialPrice = (vault / 1e9) / supply;

        let entryPrice = null;
        let txId = null;
        const enterTime = Date.now();

        while (Date.now() - enterTime < MAX_HOLD_TIME) {
          const vaultLive = await connection.getBalance(new PublicKey(vaultAddr));
          const price = (vaultLive / 1e9) / supply;

          if (!entryPrice && price >= initialPrice * 1.1) {
            entryPrice = price;
            txId = await executeLiveTrade(mint);
            console.log(`📈 Entry: ${price.toFixed(8)} SOL`);
          }

          if (entryPrice) {
            const held = Date.now() - enterTime;
            const gain = (price - entryPrice) * TRADE_SIZE - TX_FEE;
            if (price >= entryPrice * 3.0 && held >= 60000) {
              console.log(`🚀 Moonshot Exit: ${price.toFixed(8)} | Profit: ${gain.toFixed(4)} SOL`);
              break;
            }
            if (price >= entryPrice * 1.5 || held >= MAX_HOLD_TIME) {
              console.log(`⚠️ Fallback Exit: ${price.toFixed(8)} | Profit: ${gain.toFixed(4)} SOL`);
              break;
            }
          }

          await new Promise(r => setTimeout(r, 2000));
        }
      }

      await new Promise(r => setTimeout(r, 5000));
    } catch (err) {
      console.error(`❌ Error: ${err.message}`);
      await new Promise(r => setTimeout(r, 10000));
    }
  }
}

monitorAndSnipe();
