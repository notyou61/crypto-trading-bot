const fs = require("fs");
const path = require("path");

const walletPath = path.join(__dirname, "simulatedWallet.json");
const runLogPath = path.join(__dirname, "runs", "run_log.csv");

function checkWallet() {
  if (!fs.existsSync(walletPath)) return console.log("❌ No wallet found.");
  const wallet = JSON.parse(fs.readFileSync(walletPath, "utf8"));
  console.log("📦 Current Wallet Status:");
  console.log(`→ Balance: ${wallet.balance.toFixed(3)} SOL`);
  console.log(`→ Moonshots: ${wallet.totalMoonshots}`);
  console.log(`→ Partial Exits: ${wallet.totalPartials}`);
  console.log(`→ Skipped: ${wallet.totalSkipped}`);
  console.log(`→ Total Profit: ${wallet.totalProfit.toFixed(3)} SOL\n`);
}

function checkLastRun() {
  if (!fs.existsSync(runLogPath)) return console.log("❌ No run log found.");
  const lines = fs.readFileSync(runLogPath, "utf8").trim().split("\n");
  const last = lines[lines.length - 1];
  console.log("📊 Last Run Summary:");
  console.log(last);
}

checkWallet();
checkLastRun();