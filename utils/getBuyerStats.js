
import axios from 'axios';

export async function getBuyerStats(mint) {
  try {
    const url = `https://api.helius.xyz/v0/token/${mint}/buyers?limit=100&api-key=${process.env.HELIUS_API_KEY}`;
    const res = await axios.get(url);
    const data = res.data;

    if (!data?.length) console.warn(`⚠️ No buyer stats for ${mint}`);
    return { recentGainFactor: 1.05 }; // Mock fallback or compute from data
  } catch (err) {
    console.error(`❌ Error in getBuyerStats for ${mint}:`, err.message);
    return null;
  }
}
