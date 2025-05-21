// emailReport.js
import fs from 'fs';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { format } from 'date-fns';

dotenv.config();

const walletPath = './walletState.json'; // instead of simulatedWallet.json
const runLogPath = './runs/run_log.csv';

function getLastRunSummary() {
  if (!fs.existsSync(runLogPath)) return null;
  const lines = fs.readFileSync(runLogPath, 'utf-8').trim().split('\n');
  const lastLine = lines[lines.length - 1];
  const [timestamp, totalTrades, moonshots, partials, netProfit] = lastLine.split(',');
  return { timestamp, totalTrades, moonshots, partials, netProfit };
}

function getWalletStatus() {
  if (!fs.existsSync(walletPath)) return null;
  return JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
}

function composeEmail(wallet, summary) {
  const solToUsdRate = 166;
  const profitUsd = (wallet.totalProfit * solToUsdRate).toFixed(2);
  const summaryProfitUsd = (parseFloat(summary.netProfit) * solToUsdRate).toFixed(2);

  const tradesThisRun = parseInt(summary.totalTrades);
  const profitThisRun = parseFloat(summary.netProfit);
  const profitPerHourSOL = (profitThisRun * 60 / 60).toFixed(3); // assuming 1 run per hour
  const profitPerHourUSD = (profitPerHourSOL * solToUsdRate).toFixed(2);

  return `
📦 Wallet Status
-----------------
Balance        : ${wallet.balance.toFixed(3)} SOL
Total Trades   : ${wallet.totalTrades}
Moonshots      : ${wallet.totalMoonshots}
Partials       : ${wallet.totalPartials}
Skipped        : ${wallet.totalSkipped}
Total Profit   : ${wallet.totalProfit.toFixed(3)} SOL (~$${profitUsd} USD)

📊 Last Run Summary
---------------------
Timestamp      : ${summary.timestamp}
Trades         : ${summary.totalTrades}
Moonshots      : ${summary.moonshots}
Partials       : ${summary.partials}
Profit         : ${parseFloat(summary.netProfit).toFixed(4)} SOL (~$${summaryProfitUsd} USD)

🕒 Simulated Rate
---------------------
Trades/hour    : ~${tradesThisRun}
Profit/hour    : ~${profitPerHourSOL} SOL (~$${profitPerHourUSD} USD)
`;
}



async function sendEmailReport() {
  const wallet = getWalletStatus();
  const summary = getLastRunSummary();
if (!wallet) {
  console.error('❌ Missing wallet data.');
  return;
}

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.REPORT_EMAIL_ADDRESS,
      pass: process.env.REPORT_EMAIL_PASSWORD,
    },
  });

  const info = await transporter.sendMail({
    from: `"Solana Bot Report" <${process.env.REPORT_EMAIL_ADDRESS}>`,
    to: process.env.REPORT_EMAIL_RECIPIENT,
    subject: `Solana Bot Report – ${format(new Date(), 'yyyy-MM-dd HH:mm')}`,
    text: composeEmail(wallet, summary),
  });

  console.log(`✅ Email sent: ${info.response}`);
}

// ✅ Run and export
sendEmailReport().catch(console.error);
export { sendEmailReport };
