import axios from 'axios';
export async function getSolPrice() {
  try {
    const res = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', {
      headers: { 'User-Agent': 'PumpiyoBot/1.0' }
    });
    const solPrice = parseFloat(res.data.solana.usd);
    console.log('💰 Current SOL Price (USD):', solPrice.toFixed(2));
    return solPrice;
  } catch (err) {
    console.error('❌ Failed to fetch SOL price:', err.message);
    return null;
  }
}
if (process.argv[1].includes('getSOLPrice.js')) {
  getSolPrice();
}