// Dexscreener.js
import fs from 'fs/promises';
import axios from 'axios';
import dotenv from 'dotenv';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import raydiumSdk from '@raydium-io/raydium-sdk';
const { Raydium, fetchPoolKeys, getTokenAccountsByOwner } = raydiumSdk;
import serum from '@project-serum/serum';
const { Market, TOKEN_PROGRAM_ID } = serum;


dotenv.config();

const config = {
  HELIUS_API_KEY: process.env.HELIUS_API_KEY || '',
  PUMP_FUN_PROGRAM: process.env.PUMP_FUN_PROGRAM || '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  OUTPUT_JSON: './runs/sniper_snapshot.json',
  OUTPUT_CSV: './runs/sniper_report.csv',
  ACTIVE_TRADES_JSON: './runs/active_trades.json',
  TRADE_FEE_SOL: 0.0001,
  SOLANA_RPC: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com',
  WALLET_PRIVATE_KEY: process.env.WALLET_PRIVATE_KEY || '',
  DRY_RUN: process.env.DRY_RUN === 'true' || true, // Enable dry-run by default
  EXIT_WINDOW_SECONDS: 120, // Exit after 120 seconds or +10% gain
};

// Solana connection and wallet
const connection = new Connection(config.SOLANA_RPC, 'confirmed');
let wallet;
try {
  wallet = Keypair.fromSecretKey(bs58.decode(config.WALLET_PRIVATE_KEY));
} catch (err) {
  console.error('Invalid WALLET_PRIVATE_KEY in .env. Expected base58 string:', err.message);
  process.exit(1);
}

// Initialize Raydium SDK
const raydium = await Raydium.load({ connection });

const fetchWithRetry = async (url, retries = 3) => {
  try {
    const { data } = await axios.get(url);
    return data;
  } catch (err) {
    if (retries > 0) {
      await new Promise(res => setTimeout(res, 2000));
      return fetchWithRetry(url, retries - 1);
    }
    console.error(`API error: ${err.message}`);
    return null;
  }
};

const discoverNewTokens = async () => {
  const url = 'https://api.dexscreener.com/latest/dex/pairs/solana';
  const data = await fetchWithRetry(url);
  if (!data?.pairs?.length) {
    console.log('No new Solana tokens found.');
    return [];
  }

  // Filter new tokens (pair age < 4 hours, volume > $10,000, liquidity > $5,000, market cap < $100,000)
  const filteredPairs = data.pairs.filter(pair => {
    const pairAgeHours = (Date.now() - new Date(pair.pairCreatedAt).getTime()) / (1000 * 60 * 60);
    const volume24h = pair.volume.h24;
    const liquidity = pair.liquidity.usd;
    const marketCap = pair.fdv;
    return pairAgeHours < 4 && volume24h > 10000 && liquidity > 5000 && marketCap < 100000;
  });

  return filteredPairs.map(pair => ({
    tokenAddress: pair.baseToken.address,
    symbol: pair.baseToken.symbol,
    initialPrice: parseFloat(pair.priceUsd),
    pairUrl: pair.url,
    pairAddress: pair.pairAddress,
    volume24h: pair.volume.h24,
    liquidity: pair.liquidity.usd,
    marketCap: pair.fdv,
    pairCreatedAt: pair.pairCreatedAt,
  }));
};

const getSolPrice = async () => {
  const data = await fetchWithRetry('https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112');
  return data?.pairs?.[0]?.priceUsd ? parseFloat(data.pairs[0].priceUsd) : 100;
};

const getTokenPrice = async (tokenAddress) => {
  const data = await fetchWithRetry(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
  return data?.pairs?.[0]?.priceUsd ? parseFloat(data.pairs[0].priceUsd) : null;
};

const executeBuyOrder = async (tokenAddress, pairAddress, amountSol) => {
  if (config.DRY_RUN) {
    console.log(`[DRY RUN] Simulating buy for ${tokenAddress} with ${amountSol} SOL on pair ${pairAddress}`);
    return `dry-run-${Date.now()}`;
  }

  try {
    // Fetch pool keys for the pair
    const poolKeys = await fetchPoolKeys(connection, new PublicKey(pairAddress));
    const market = await Market.load(connection, new PublicKey(poolKeys.marketId), {}, TOKEN_PROGRAM_ID);

    // Get token accounts
    const tokenAccounts = await getTokenAccountsByOwner(connection, wallet.publicKey);
    const tokenAccount = tokenAccounts.find(ta => ta.accountInfo.mint.toBase58() === tokenAddress);

    // Placeholder for Raydium swap (simplified)
    const swapTx = await raydium.swap({
      poolKeys,
      amountIn: amountSol * 1e9, // SOL to lamports
      amountOutMinimum: 0, // Set slippage tolerance
      tokenAccountIn: tokenAccount?.pubkey || null,
      tokenAccountOut: tokenAccount?.pubkey || null,
      owner: wallet,
    });

    const signature = await connection.sendTransaction(swapTx, [wallet]);
    console.log(`Buy transaction sent for ${tokenAddress}: ${signature}`);
    return signature;
  } catch (err) {
    console.error(`Buy error for ${tokenAddress}: ${err.message}`);
    return null;
  }
};

const executeSellOrder = async (tokenAddress, pairAddress, amountTokens) => {
  if (config.DRY_RUN) {
    console.log(`[DRY RUN] Simulating sell for ${tokenAddress} with ${amountTokens} tokens on pair ${pairAddress}`);
    return `dry-run-${Date.now()}`;
  }

  // Similar to buy, implement Raydium sell logic here
  console.log(`[Placeholder] Selling ${amountTokens} tokens of ${tokenAddress}`);
  return null;
};

const loadActiveTrades = async () => {
  try {
    return JSON.parse(await fs.readFile(config.ACTIVE_TRADES_JSON));
  } catch {
    return {};
  }
};

const saveActiveTrades = async (trades) => {
  await fs.writeFile(config.ACTIVE_TRADES_JSON, JSON.stringify(trades, null, 2));
};

const runSniperBot = async () => {
  console.log('Starting sniper bot...');
  const solPrice = await getSolPrice();
  const tokens = await discoverNewTokens();
  const activeTrades = await loadActiveTrades();

  if (!tokens.length) {
    console.log('No viable tokens found. Retrying in 60 seconds...');
    return;
  }

  const results = [];
  for (const token of tokens) {
    // Skip if already in active trades
    if (activeTrades[token.tokenAddress]) {
      console.log(`Skipping ${token.symbol}: already in active trades`);
      continue;
    }

    const shouldTrade = token.initialPrice < 0.01 && token.volume24h > 15000;
    if (shouldTrade) {
      const signature = await executeBuyOrder(token.tokenAddress, token.pairAddress, 0.1); // Buy 0.1 SOL
      if (signature) {
        activeTrades[token.tokenAddress] = {
          symbol: token.symbol,
          buyPrice: token.initialPrice,
          buyTime: Date.now(),
          signature,
        };
        await saveActiveTrades(activeTrades);
      }
    }

    results.push({
      ...token,
      shouldTrade,
      exitPrice: null, // Will be updated in exit logic
      slippage: null,
      exitAdjusted: null,
      netProfitSOL: null,
      netProfitUSD: null,
    });
  }

  // Poll for exit conditions
  for (const token of Object.values(activeTrades)) {
    const currentPrice = await getTokenPrice(token.tokenAddress);
    if (!currentPrice) continue;

    const timeElapsed = (Date.now() - token.buyTime) / 1000;
    const gain = ((currentPrice - token.buyPrice) / token.buyPrice) * 100;

    if (timeElapsed > config.EXIT_WINDOW_SECONDS || gain >= 10) {
      const slippage = Math.min(5, Math.max(1, gain / 40));
      const adjustedExit = currentPrice * (1 - slippage / 100);
      const netSol = ((adjustedExit - token.buyPrice) / solPrice) - config.TRADE_FEE_SOL;

      results.push({
        tokenAddress: token.tokenAddress,
        symbol: token.symbol,
        initialPrice: token.buyPrice,
        exitPrice: currentPrice,
        pairUrl: (tokens.find(t => t.tokenAddress === token.tokenAddress) || {}).pairUrl,
        pairAddress: (tokens.find(t => t.tokenAddress === token.tokenAddress) || {}).pairAddress,
        volume24h: (tokens.find(t => t.tokenAddress === token.tokenAddress) || {}).volume24h,
        liquidity: (tokens.find(t => t.tokenAddress === token.tokenAddress) || {}).liquidity,
        marketCap: (tokens.find(t => t.tokenAddress === token.tokenAddress) || {}).marketCap,
        pairCreatedAt: (tokens.find(t => t.tokenAddress === token.tokenAddress) || {}).pairCreatedAt,
        slippage: `${slippage.toFixed(2)}%`,
        exitAdjusted: parseFloat(adjustedExit.toFixed(8)),
        netProfitSOL: parseFloat(netSol.toFixed(8)),
        netProfitUSD: parseFloat((netSol * solPrice).toFixed(4)),
        shouldTrade: false,
      });

      if (!config.DRY_RUN) {
        await executeSellOrder(token.tokenAddress, token.pairAddress, 0); // Replace with actual token amount
      }
      delete activeTrades[token.tokenAddress];
      await saveActiveTrades(activeTrades);
    }
  }

  // Save results to JSON
  await fs.writeFile(config.OUTPUT_JSON, JSON.stringify(results, null, 2));

  // Save results to CSV
  const csvContent = [
    'Token,Address,Initial Price,Exit Price,Slippage,Net Profit SOL,Net Profit USD,Volume 24h,Liquidity,Market Cap,Pair URL',
    ...results.map(t => `${t.symbol},${t.tokenAddress},${t.initialPrice || ''},${t.exitPrice || ''},${t.slippage || ''},${t.netProfitSOL || ''},${t.netProfitUSD || ''},${t.volume24h || ''},${t.liquidity || ''},${t.marketCap || ''},${t.pairUrl || ''}`)
  ].join('\n');
  await fs.writeFile(config.OUTPUT_CSV, csvContent);

  console.log(`✅ Processed ${results.length} tokens. Saved to ${config.OUTPUT_JSON} and ${config.OUTPUT_CSV}`);
};

const main = async () => {
  try {
    await runSniperBot();
    setInterval(runSniperBot, 60 * 1000); // Run every 60 seconds
  } catch (err) {
    console.error(`Bot error: ${err.message}`);
  }
};

main();