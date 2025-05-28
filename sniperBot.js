// sniperBot.js
import { Connection, PublicKey, Keypair, Transaction } from '@solana/web3.js';
import { createJupiterApiClient } from '@jup-ag/api';
import { Helius } from 'helius-sdk';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import bs58 from 'bs58';

dotenv.config();

// Configuration from .env
const config = {
  RPC_ENDPOINT: process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com',
  HELIUS_API_KEY: process.env.HELIUS_API_KEY || '',
  PUMP_FUN_PROGRAM: process.env.PUMP_FUN_PROGRAM || '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  WALLET_PRIVATE_KEY: process.env.WALLET_PRIVATE_KEY || '',
  TRADE_LOG_PATH: process.env.TRADE_LOG_PATH || './runs/trade_log.json',
  SNOWBALL_STATE_PATH: process.env.SNOWBALL_STATE_PATH || './runs/snowball_state.json',
  FALLBACK_SOL_PRICE: parseFloat(process.env.FALLBACK_SOL_PRICE) || 166.0,
  TRADE_SIZE: parseFloat(process.env.TRADE_SIZE) || 0.05,
  SLIPPAGE: parseFloat(process.env.SLIPPAGE) || 0.03,
  TX_FEE: parseFloat(process.env.TX_FEE) || 0.0001,
  MAX_HOLD_TIME: parseInt(process.env.MAX_HOLD_TIME) || 120000,
};

// Initialize Solana connection, wallet, and Helius
const connection = new Connection(config.RPC_ENDPOINT, 'confirmed');
let wallet;
try {
  const decodedKey = bs58.decode(config.WALLET_PRIVATE_KEY);
  if (decodedKey.length !== 64) {
    throw new Error(`Invalid private key length: ${decodedKey.length} bytes (expected 64)`);
  }
  wallet = Keypair.fromSecretKey(decodedKey);
  console.log(`INFO: Wallet public key: ${wallet.publicKey.toString()}`);
} catch (err) {
  throw new Error(`Failed to load wallet: ${err.message}`);
}
const helius = new Helius(config.HELIUS_API_KEY);

// Initialize Jupiter Aggregator
const jupiter = createJupiterApiClient();

// Fetch SOL/USD price
async function getSolPrice() {
  try {
    const response = await axios.get('https://price.jup.ag/v4/price?ids=SOL');
    const price = response.data.data.SOL.price;
    console.log(`INFO: Fetched SOL price: $${price.toFixed(2)}`);
    return price;
  } catch (err) {
    console.warn(`WARN: Failed to fetch SOL price: ${err.message}. Using fallback: $${config.FALLBACK_SOL_PRICE}`);
    return config.FALLBACK_SOL_PRICE;
  }
}

// Fetch token supply
async function getTokenSupply(mintAddress) {
  try {
    const mintPubkey = new PublicKey(mintAddress);
    const mintInfo = await connection.getParsedAccountInfo(mintPubkey);
    if (!mintInfo.value) throw new Error(`No mint data for ${mintAddress}`);
    const supply = mintInfo.value.data.parsed.info.supply / 1_000_000; // 6 decimals
    console.log(`INFO: Token ${mintAddress} supply: ${supply} tokens`);
    return supply;
  } catch (err) {
    console.warn(`ERROR: Failed to fetch token supply for ${mintAddress}: ${err.message}`);
    return null;
  }
}

// Fetch vault balance
async function getVaultBalance(vaultAddress) {
  try {
    const vaultPubkey = new PublicKey(vaultAddress);
    const balance = await connection.getBalance(vaultPubkey);
    const solBalance = balance / 1_000_000_000; // Lamports to SOL
    console.log(`INFO: Vault ${vaultAddress} balance: ${solBalance} SOL`);
    return solBalance;
  } catch (err) {
    console.warn(`ERROR: Failed to fetch vault balance for ${vaultAddress}: ${err.message}`);
    return null;
  }
}

// Derive vault address
async function getVaultAddress(mintAddress) {
  try {
    const programPubkey = new PublicKey(config.PUMP_FUN_PROGRAM);
    const mintPubkey = new PublicKey(mintAddress);
    const [vaultPda] = await PublicKey.findProgramAddress(
      [Buffer.from('bonding-curve'), mintPubkey.toBuffer()],
      programPubkey
    );
    const balance = await connection.getBalance(vaultPda);
    if (balance === 0) throw new Error('Vault has no balance');
    console.log(`INFO: Vault address for ${mintAddress}: ${vaultPda.toString()}`);
    return vaultPda.toString();
  } catch (err) {
    console.warn(`ERROR: Failed to derive vault address for ${mintAddress}: ${err.message}`);
    return null;
  }
}

// Calculate token price (refined bonding curve)
function calculatePrice(tokenSupply, solInVault) {
  const basePrice = solInVault / tokenSupply; // Price per token in SOL
  const curveFactor = Math.log10(tokenSupply / 1_000_000 + 1) * 0.0001;
  return basePrice * curveFactor;
}

// Monitor and trade a single token
async function snipeToken(mintAddress, startTime) {
  const solPrice = await getSolPrice();
  const vaultAddress = await getVaultAddress(mintAddress);
  if (!vaultAddress) {
    console.warn(`WARN: Skipping ${mintAddress} due to invalid vault address`);
    return;
  }

  let initialPrice = null;
  let tradeExecuted = false;
  let tradeLog = {
    timestamp: new Date().toISOString(),
    mintAddress,
    vaultAddress,
    entryPrice: null,
    exitPrice: null,
    profitSol: 0,
    profitUsd: 0,
    status: 'skipped',
    buyers10s: 0,
    buyers30s: 0,
  };

  // Fetch initial buyer activity
  const buyerStats = await getBuyerStats(mintAddress, startTime);
  if (!buyerStats) {
    console.warn(`WARN: Skipping ${mintAddress} due to missing buyer data`);
    return;
  }
  tradeLog.buyers10s = buyerStats.buyers10s;
  tradeLog.buyers30s = buyerStats.buyers30s;

  // Poll price for 120s
  const start = Date.now();
  while (Date.now() - start < config.MAX_HOLD_TIME) {
    const tokenSupply = await getTokenSupply(mintAddress);
    const solInVault = await getVaultBalance(vaultAddress);
    if (!tokenSupply || !solInVault) {
      console.warn(`WARN: Skipping ${mintAddress} due to missing data`);
      return;
    }

    const currentPrice = calculatePrice(tokenSupply, solInVault);
    if (!initialPrice) initialPrice = currentPrice;

    // v3 Strategy: Buy Trigger (+10% profit-in-place)
    if (!tradeExecuted && currentPrice >= initialPrice * 1.10 && tradeLog.buyers10s >= 2) {
      tradeExecuted = true;
      tradeLog.entryPrice = currentPrice;
      tradeLog.status = 'entered';
      console.log(`INFO: Buying ${mintAddress} at ${currentPrice.toFixed(8)} SOL ($${currentPrice * solPrice.toFixed(2)} USD)`);

      try {
        const quote = await jupiter.quoteGet({
          inputMint: 'So11111111111111111111111111111111111111112',
          outputMint: mintAddress,
          amount: Math.floor(config.TRADE_SIZE * 1_000_000_000),
          slippageBps: Math.floor(config.SLIPPAGE * 10000),
        });
        const { swapTransaction } = await jupiter.swapPost({
          swapRequest: {
            quoteResponse: quote,
            userPublicKey: wallet.publicKey.toString(),
            wrapAndUnwrapSol: true,
          },
        });
        const tx = Transaction.from(Buffer.from(swapTransaction, 'base64'));
        tx.sign(wallet);
        const txId = await connection.sendRawTransaction(tx.serialize());
        console.log(`INFO: Buy executed for ${mintAddress}: ${txId}`);
      } catch (err) {
        console.error(`ERROR: Buy failed for ${mintAddress}: ${err.message}`);
        tradeLog.status = 'failed';
        break;
      }
    }

    // v3 Strategy: Exit Logic
    if (tradeExecuted) {
      const priceGain = (currentPrice / tradeLog.entryPrice - 1) * 100;
      const holdTime = (Date.now() - start) / 1000;

      if (priceGain >= 200 && holdTime >= 60) {
        tradeLog.exitPrice = currentPrice;
        tradeLog.profitSol = (currentPrice - tradeLog.entryPrice) * (config.TRADE_SIZE / tradeLog.entryPrice) - config.TX_FEE;
        tradeLog.profitUsd = tradeLog.profitSol * solPrice;
        tradeLog.status = 'moonshot';
        console.log(`INFO: Moonshot exit for ${mintAddress}: ${tradeLog.profitSol.toFixed(4)} SOL`);
        break;
      }
      if (priceGain >= 50 || holdTime >= 120) {
        tradeLog.exitPrice = currentPrice;
        tradeLog.profitSol = (currentPrice - tradeLog.entryPrice) * (config.TRADE_SIZE / tradeLog.entryPrice) - config.TX_FEE;
        tradeLog.profitUsd = tradeLog.profitSol * solPrice;
        tradeLog.status = priceGain >= 50 ? 'partial' : 'timeout';
        console.log(`INFO: ${tradeLog.status} exit for ${mintAddress}: ${tradeLog.profitSol.toFixed(4)} SOL`);
        break;
      }
    }

    await new Promise(resolve => setTimeout(resolve, 5000)); // Poll every 5s
  }

  // Execute sell
  if (tradeExecuted && tradeLog.exitPrice) {
    try {
      const tokenAmount = Math.floor((config.TRADE_SIZE / tradeLog.entryPrice) * 1_000_000);
      const quote = await jupiter.quoteGet({
        inputMint: mintAddress,
        outputMint: 'So11111111111111111111111111111111111111112',
        amount: tokenAmount,
        slippageBps: Math.floor(config.SLIPPAGE * 10000),
      });
      const { swapTransaction } = await jupiter.swapPost({
        swapRequest: {
          quoteResponse: quote,
          userPublicKey: wallet.publicKey.toString(),
          wrapAndUnwrapSol: true,
        },
      });
      const tx = Transaction.from(Buffer.from(swapTransaction, 'base64'));
      tx.sign(wallet);
      const txId = await connection.sendRawTransaction(tx.serialize());
      console.log(`INFO: Sell executed for ${mintAddress}: ${txId}`);
    } catch (err) {
      console.error(`ERROR: Sell failed for ${mintAddress}: ${err.message}`);
      tradeLog.status = 'failed';
    }
  }

  // Log trade
  try {
    let logData = [];
    try {
      const raw = await fs.readFile(config.TRADE_LOG_PATH, 'utf8');
      logData = JSON.parse(raw);
    } catch {
      console.log('INFO: No existing trade log, creating new one...');
    }
    logData.push(tradeLog);
    await fs.mkdir(path.dirname(config.TRADE_LOG_PATH), { recursive: true });
    await fs.writeFile(config.TRADE_LOG_PATH, JSON.stringify(logData, null, 2));
    console.log(`SUCCESS: Trade log saved to ${config.TRADE_LOG_PATH}`);
  } catch (err) {
    console.error(`ERROR: Failed to write trade log: ${err.message}`);
  }

  // Update snowball
  if (tradeLog.profitSol > 0) {
    await manageSnowball(tradeLog.profitSol);
  }

  return tradeLog;
}

// Fetch buyer stats
async function getBuyerStats(mintAddress, startTime) {
  try {
    const signatures = await connection.getSignaturesForAddress(new PublicKey(mintAddress), { limit: 10 });
    const tx = await connection.getParsedTransaction(signatures[0].signature, { maxSupportedTransactionVersion: 0 });
    const transfers = tx?.meta?.innerInstructions?.flatMap(ii => ii.instructions) || [];
    const buyers10s = new Set(
      transfers
        .filter(t => t.parsed?.type === 'transfer' && t.parsed.info.destination && t.parsed.info.source !== mintAddress)
        .filter(t => t.timestamp * 1000 <= startTime + 10000)
        .map(t => t.parsed.info.source)
    ).size;
    const buyers30s = new Set(
      transfers
        .filter(t => t.parsed?.type === 'transfer' && t.parsed.info.destination && t.parsed.info.source !== mintAddress)
        .filter(t => t.timestamp * 1000 <= startTime + 30000)
        .map(t => t.parsed.info.source)
    ).size;
    return { buyers10s, buyers30s };
  } catch (err) {
    console.warn(`WARN: Failed to fetch buyer stats for ${mintAddress}: ${err.message}`);
    return null;
  }
}

// Monitor new token launches
async function monitorLaunches() {
  if (!config.HELIUS_API_KEY) {
    console.error('ERROR: HELIUS_API_KEY not set in .env');
    return;
  }

  console.log('INFO: Starting token launch monitoring...');
  const url = `https://api.helius.xyz/v0/addresses/${config.PUMP_FUN_PROGRAM}/transactions?api-key=${config.HELIUS_API_KEY}`;
  const seen = new Set();

  while (true) {
    try {
      const txs = await axios.get(url).then(res => res.data);
      for (const tx of txs) {
        const transfer = tx.tokenTransfers?.find(t => t.mint?.endsWith('pump') && !seen.has(t.mint));
        if (!transfer?.mint) continue;

        seen.add(transfer.mint);
        console.log(`INFO: New token detected: ${transfer.mint}`);
        await snipeToken(transfer.mint, tx.timestamp * 1000);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (err) {
      console.error(`ERROR: Failed to fetch transactions: ${err.message}`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

// Snowball strategy
async function manageSnowball(profitSol) {
  let snowballState = { bankroll: 0.5, status: 'active', tradesExecuted: 0, target: 5.0 };
  try {
    const raw = await fs.readFile(config.SNOWBALL_STATE_PATH, 'utf8');
    snowballState = JSON.parse(raw);
  } catch {
    console.log('INFO: No snowball state found, starting fresh...');
  }

  snowballState.bankroll += profitSol;
  snowballState.tradesExecuted += 1;

  if (snowballState.bankroll >= snowballState.target) {
    snowballState.status = 'reserve_mode';
    console.log(`INFO: Snowball complete: ${snowballState.bankroll.toFixed(4)} SOL`);
  }

  try {
    await fs.mkdir(path.dirname(config.SNOWBALL_STATE_PATH), { recursive: true });
    await fs.writeFile(config.SNOWBALL_STATE_PATH, JSON.stringify(snowballState, null, 2));
    console.log(`SUCCESS: Snowball state saved to ${config.SNOWBALL_STATE_PATH}`);
  } catch (err) {
    console.error(`ERROR: Failed to save snowball state: ${err.message}`);
  }

  return snowballState;
}

// Run the bot
(async () => {
  try {
    if (!config.WALLET_PRIVATE_KEY || !config.HELIUS_API_KEY) {
      throw new Error('Missing WALLET_PRIVATE_KEY or HELIUS_API_KEY in .env');
    }
    console.log('INFO: Starting sniper bot...');
    await monitorLaunches();
  } catch (err) {
    console.error(`ERROR: Fatal error: ${err.message}`);
    process.exit(1);
  }
})();