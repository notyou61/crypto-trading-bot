// utils/getTokenPrice.js
import axios from 'axios';

export async function getTokenPrice(mint, quoteApiUrl, slippageBps, inputAmountSol = 0.05) {
  try {
    const inputMint = 'So11111111111111111111111111111111111111112'; // SOL
    const amount = Math.floor(inputAmountSol * 1e9); // Convert to lamports

    const url = `${quoteApiUrl}?inputMint=${inputMint}&outputMint=${mint}&amount=${amount}&slippageBps=${slippageBps}`;
    const res = await axios.get(url);

    const route = res.data?.data?.[0];
    if (!route) return null;

    const outAmount = parseFloat(route.outAmount) / 1e9;
    if (!outAmount || outAmount === 0) return null;

    const priceUsd = inputAmountSol / outAmount;
    return priceUsd;
  } catch {
    return null;
  }
}

