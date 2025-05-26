// getSOLPrice.js
import axios from 'axios';

export async function getSolPrice() {
  try {
    const res = await axios.get('https://api.coinbase.com/v2/prices/SOL-USD/spot');
    const solPrice = parseFloat(res.data.data.amount);
    console.log('💰 Current SOL Price (USD):', solPrice.toFixed(2));
    return solPrice;
  } catch (err) {
    console.error('❌ Failed to fetch SOL price:', err.message);
    return null;
  }
}

// If run directly, fetch and print
if (process.argv[1].includes('getSolPrice.js')) {
  getSolPrice();
}
