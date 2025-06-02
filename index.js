// index.js
// Description: Solana meme coin trading bot entry point
// Author: Steve Skye
// Imports
import dotenv from 'dotenv';
import { Connection } from '@solana/web3.js';
import { getTokenPrice } from './utils/getTokenPrice.js';
import { fetchRecentMints } from './utils/fetchRecentMints.js';
// Load environment variables
dotenv.config();
// Set up the connection to Solana mainnet
const connection = new Connection('https://api.mainnet-beta.solana.com');
// Array to track active tokens
let trackedTokens = [];
// Function to fetch recent mints and populate tracking list
async function updateTrackedTokens() {
  const mints = await fetchRecentMints();
  trackedTokens = mints.map(mint => ({
    mint,
    entryPrice: 0.001, // Starting price assumption (will vary in real use)
    entryTime: Date.now(),
    status: 'holding'
  }));
}
// Function to evaluate token performance and make trading decisions
function evaluateToken(token, currentPrice) {
  const gain = currentPrice / token.entryPrice;
  const heldSeconds = Math.floor((Date.now() - token.entryTime) / 1000);
  let decision = 'hold';

  if (gain >= 2.0 && heldSeconds >= 60) decision = 'moon-hold';
  else if (gain >= 1.5) decision = 'fast-flip';
  else if (gain <= 0.9 && heldSeconds >= 30) decision = 'slow-rug';
  else if (gain < 1.0 && heldSeconds >= 60) decision = 'break-even bail';

  return { ...token, gain, heldSeconds, decision };
}
// Function to monitor token prices and log evaluation results
async function monitorTokens() {
  for (const token of trackedTokens) {
    try {
      const currentPrice = await getTokenPrice(token.mint);
      const result = evaluateToken(token, currentPrice);
      console.log(`📈 [${token.mint}] Price: ${currentPrice.toFixed(6)} | Held: ${result.heldSeconds}s | Decision: ${result.decision}`);
    } catch (err) {
      console.error(`❌ Error for ${token.mint}:`, err.message);
    }
  }
}
// Main bot loop to initialize and start periodic monitoring
(async () => {
  await updateTrackedTokens();
  console.log(`🔁 Monitoring ${trackedTokens.length} tokens...`);
  setInterval(monitorTokens, 5000);
})();