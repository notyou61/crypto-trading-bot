import 'dotenv/config';
import { Connection, Keypair, clusterApiUrl, LAMPORTS_PER_SOL } from '@solana/web3.js';

// Load Wallet from .env Private Key
function loadWallet(envKey) {
    const privateKeyArray = process.env[envKey].split(',').map(Number);
    return Keypair.fromSecretKey(Uint8Array.from(privateKeyArray));
}

const rpcEndpoint = process.env.RPC_ENDPOINT || clusterApiUrl('mainnet-beta');
const connection = new Connection(rpcEndpoint);

async function checkBalance(walletName, envKey) {
    const wallet = loadWallet(envKey);
    const balanceLamports = await connection.getBalance(wallet.publicKey);
    const balanceSOL = balanceLamports / LAMPORTS_PER_SOL;
    console.log(`${walletName} Wallet: ${wallet.publicKey.toBase58()}`);
    console.log(`Balance: ${balanceSOL} SOL\n`);
}

(async () => {
    await checkBalance('Phantom', 'PHANTOM_PRIVATE_KEY');
    await checkBalance('Photon', 'PHOTON_PRIVATE_KEY');
})();
