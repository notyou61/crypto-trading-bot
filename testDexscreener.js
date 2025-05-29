// testDexscreener.js
import fetch from 'node-fetch'; // omit if using Node 18+

const tokenAddress = '9NWUanJ4kJZJQiSfDL6bznAFF46QpPKmJ6fadhpMpump';
const url = `https://api.dexscreener.com/latest/dex/pairs/solana/${tokenAddress}`;

fetch(url)
  .then(res => res.json())
  .then(data => {
    if (data.pair) {
      console.log('✅ Price (USD):', data.pair.priceUsd);
    } else {
      console.log('⚠️ No data found for token.');
    }
  })
  .catch(err => console.error('Fetch failed:', err));
