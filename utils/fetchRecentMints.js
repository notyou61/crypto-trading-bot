import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const PUMP_FUN_CREATOR = '6EF8rrecthR5Dkzon8ZZya95FyK4ehzTrJvGVU5z5yR';

export async function fetchRecentMints() {
  const url = `https://api.helius.xyz/v0/addresses/${PUMP_FUN_CREATOR}/assets?api-key=${HELIUS_API_KEY}&limit=10`;
  const res = await axios.get(url);
  return res.data.map(a => a.id).filter(id => typeof id === 'string' && id.length === 44);
}