import { Connection, PublicKey } from '@solana/web3.js';
import dotenv from 'dotenv';
dotenv.config();

// ✅ Use RPC_ENDPOINT_1 from your .env
const connection = new Connection(process.env.RPC_ENDPOINT_1);

// ✅ Mint and Vault addresses from Pump.fun example token
const MINT_ADDRESS = new PublicKey('9NWUanJ4kJZJQiSfDL6bznAFF46QpPKmJ6fadhpMpump');
const VAULT_ADDRESS = new PublicKey('2wQ2PKSkhGeXyAFUyxGS4GeBLZuLYkQY6AdYMcq2KmzG');

// 🔧 Tunable bonding curve constant (placeholder)
const BONDING_CURVE_K = 0.00000005;

async function estimatePrice() {
  try {
    // Token supply
    const mintInfo = await connection.getParsedAccountInfo(MINT_ADDRESS);
    const supplyRaw = mintInfo.value?.data?.parsed?.info?.supply;

    if (!supplyRaw) {
      console.error('❌ Could not fetch supply info');
      return;
    }

    const supply = Number(supplyRaw) / 1e9;

    // Vault SOL balance
    const vaultLamports = await connection.getBalance(VAULT_ADDRESS);
    const vaultSol = vaultLamports / 1e9;

    // Estimate price (basic linear bonding curve model)
    const priceEstimate = supply * BONDING_CURVE_K;

    console.log(`📊 Token Supply: ${supply}`);
    console.log(`💰 Vault SOL: ${vaultSol}`);
    console.log(`✅ Estimated Price (SOL): ${priceEstimate.toFixed(8)}`);
  } catch (err) {
    console.error('❌ Error:', err.message || err);
  }
}

estimatePrice();
