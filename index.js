// Import Required Libraries
import 'dotenv/config';
import fs from 'fs';
import { Connection, PublicKey } from '@solana/web3.js';

// Configuration
const RPC_ENDPOINT = process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
console.log('Using RPC Endpoint:', RPC_ENDPOINT);
const PUMPFUN_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const connection = new Connection(RPC_ENDPOINT, 'confirmed');

// Utility: Delay function
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Placeholder: Analyze Buyer Activity
async function analyzeBuyerActivity() {
    return {
        buyers10s: Math.floor(Math.random() * 10),
        buyers30s: Math.floor(Math.random() * 30),
        buyers5m: Math.floor(Math.random() * 100),
    };
}

// Placeholder: Extract Initial Liquidity
async function extractInitialLiquidity() {
    return Math.floor(Math.random() * 100);
}

// Placeholder: Analyze Price Movement and Max Pump
async function analyzePriceAction() {
    return {
        maxPriceAchievedPct: Math.floor(Math.random() * 500),
        timeAtMaxPriceSec: Math.floor(Math.random() * 300),
    };
}

// Fetch Token Launches with Extended Metrics and Running Total
async function fetchTokenLaunches(targetCount = 500) {
    let launches = [];
    let before = undefined;
    let runningTotalSOL = 0;

    while (launches.length < targetCount) {
        console.log(`Fetching batch... Valid launches collected: ${launches.length}/${targetCount}`);
        const signatures = await connection.getSignaturesForAddress(PUMPFUN_PROGRAM_ID, {
            limit: 20,
            before: before,
        });

        if (!signatures.length) break;

        for (const sigInfo of signatures) {
            before = sigInfo.signature;

            try {
                const tx = await connection.getParsedTransaction(sigInfo.signature, {
                    maxSupportedTransactionVersion: 0,
                });

                if (!tx || tx.meta?.err) continue;

                const creatorWallet = String(tx.transaction.message.accountKeys[0]);
                const timestamp = sigInfo.blockTime
                    ? new Date(sigInfo.blockTime * 1000).toISOString()
                    : 'Unknown';

                const initialLiquidity = await extractInitialLiquidity();
                const buyerActivity = await analyzeBuyerActivity();
                const priceAction = await analyzePriceAction();

                // Apply Smart Entry/Exit and Position Sizing
                const SOL_PRICE_USD = 175.00;
                const FULL_BUY_IN_SOL = 0.1;
                const REDUCED_BUY_IN_SOL = 0.05;
                const EARLY_EXIT_PROFIT_PCT = 50.0;
                const MOONSHOT_PROFIT_PCT = 200.0;

                const buyIn = buyerActivity.buyers10s >= 5 ? FULL_BUY_IN_SOL : REDUCED_BUY_IN_SOL;

                let tradeResult = "Skipped";
                let profitSOL = 0;

                if (buyerActivity.buyers10s >= 5) {
                    if (buyerActivity.buyers30s >= 10) {
                        if (priceAction.maxPriceAchievedPct >= MOONSHOT_PROFIT_PCT) {
                            profitSOL = buyIn * (MOONSHOT_PROFIT_PCT / 100);
                            tradeResult = "Moonshot (Win)";
                        } else {
                            profitSOL = buyIn * (EARLY_EXIT_PROFIT_PCT / 100);
                            tradeResult = "Partial Exit (Win)";
                        }
                    } else {
                        profitSOL = buyIn * (EARLY_EXIT_PROFIT_PCT / 100);
                        tradeResult = "Partial Exit (Win)";
                    }
                }

                runningTotalSOL += profitSOL;

                launches.push({
                    Signature: sigInfo.signature,
                    CreatorWallet: creatorWallet,
                    LaunchTimestamp: timestamp,
                    InitialLiquidity: initialLiquidity,
                    Buyers10s: buyerActivity.buyers10s,
                    Buyers30s: buyerActivity.buyers30s,
                    Buyers5m: buyerActivity.buyers5m,
                    MaxPriceAchievedPct: priceAction.maxPriceAchievedPct,
                    TimeAtMaxPriceSec: priceAction.timeAtMaxPriceSec,
                    TradeResult: tradeResult,
                    Profit_SOL: profitSOL,
                    RunningTotal_SOL: runningTotalSOL
                });

                if (launches.length >= targetCount) break;

            } catch (err) {
                console.error(`Error processing transaction ${sigInfo.signature}:`, err.message);
            }

            await delay(500);
        }
    }

    saveResultsToCSV(launches);
}

// Save Results to CSV with Unique Filename + Log Summary
function saveResultsToCSV(data) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `runs/pumpfun_launches_${timestamp}.csv`;

    const header = 'Signature,CreatorWallet,LaunchTimestamp,InitialLiquidity,Buyers10s,Buyers30s,Buyers5m,MaxPriceAchievedPct,TimeAtMaxPriceSec,TradeResult,Profit_SOL,RunningTotal_SOL\n';
    const rows = data
        .map(row =>
            `${row.Signature},${row.CreatorWallet},${row.LaunchTimestamp},${row.InitialLiquidity},${row.Buyers10s},${row.Buyers30s},${row.Buyers5m},${row.MaxPriceAchievedPct},${row.TimeAtMaxPriceSec},${row.TradeResult},${row.Profit_SOL},${row.RunningTotal_SOL}`
        )
        .join('\n');
    fs.mkdirSync('runs', { recursive: true });
    fs.writeFileSync(filename, header + rows);
    console.log(`✅ Saved results to ${filename}`);

    // Append to run log
    const totalTrades = data.length;
    const moonshots = data.filter(r => r.TradeResult === "Moonshot (Win)").length;
    const partials = data.filter(r => r.TradeResult === "Partial Exit (Win)").length;
    const netProfit = data.reduce((sum, r) => sum + r.Profit_SOL, 0);

    const logLine = `${timestamp},${totalTrades},${moonshots},${partials},${netProfit.toFixed(4)}\n`;
    const logHeader = 'Timestamp,TotalTrades,Moonshots,PartialExits,NetProfitSOL\n';
    if (!fs.existsSync('runs/run_log.csv')) {
        fs.writeFileSync('runs/run_log.csv', logHeader);
    }
    fs.appendFileSync('runs/run_log.csv', logLine);
}

// Run the Analyzer
fetchTokenLaunches(500);
