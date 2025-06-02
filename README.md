# Solana Meme Coin Trading Bot

## 📌 Project Overview

This project is a fully automated trading bot designed to monitor and trade new meme coin launches on the Solana blockchain, specifically from Pump.fun. It executes trades based on price movement, buyer activity, and a multi-tier sell strategy. The system simulates live behavior but is modular enough to enable real trading once API integrations and security audits are finalized.

---

## ⚙️ Features

- Detects new meme coin launches from Pump.fun using the Helius API.
- Evaluates price and buyer action using DexScreener and Raydium data.
- Entry strategy: Buy if token gains +10% in first minute.
- Exit strategy tiers: Fast-flip, Moon-hold, Slow-rug, Break-even bail.
- Live token tracking and decision engine every 5 seconds.
- Token lifecycle observer with auto report generation.
- Fully modular design using ES Modules and environment variables.

---

## 🗂️ Project Structure

```
crypto-trading-bot/
├── .env                            # Environment variables (API keys, wallet keys)
├── index.js                        # Main bot loop
├── utils/
│   ├── getTokenPrice.js            # Price fetch logic (DexScreener/Raydium)
│   ├── fetchRecentMints.js        # Mint fetch logic (Helius or fallback)
├── reports/
│   └── trade_report.html          # After action reports
├── package.json                   # NPM scripts and dependency manifest
```

---

## 🔐 Environment Configuration (.env)

```
HOT_WALLET_PRIVATE_KEY=[BASE58]
SPENDING_WALLET_ADDRESS=...
BANK_WALLET_ADDRESS=...
COLD_WALLET_ADDRESS=...
RPC_ENDPOINT=https://api.mainnet-beta.solana.com
DEXSCREENER_API=https://api.dexscreener.io/latest/dex/pairs/...
HELIUS_API_KEY=...
```

---

## 🚀 Running the Bot

From the project root, install dependencies:

```bash
npm install
```

Run the bot:

```bash
npm start
```

Or directly:

```bash
node index.js
```

---

## 🧠 Strategy Logic (v3)

- **Buy trigger:** Token reaches +10% from launch price.
- **Sell logic:**
  - `moon-hold`: Sell at +200% if held ≥ 60 seconds
  - `fast-flip`: Sell at +50%+
  - `slow-rug`: Exit at -10% if held ≥ 30s
  - `break-even bail`: Exit near-entry after 60s

---

## 📊 Reporting

- Report auto-generates `trade_report.html` after lifecycle ends.
- Reports include mint address, entry/exit price, duration held, and strategy triggered.

---

## 🧱 Future Enhancements

- Live buy/sell execution via Jupiter Aggregator.
- Interactive web dashboard for real-time bot telemetry.
- Wallet profit tracking across tiers.
- Token metadata visualization.

---

## 📌 Notes

- Always confirm `.env` is secure and excluded from source control.
- Bot defaults to **console output**. Can be extended to log JSON or upload to dashboard.

---

## ✍️ Author

Steve Skye  
Account Executive & Sign Permit Specialist  
Christy Signs | Phoenix, AZ  
Project Lead: Meme Coin Trading Bot on Solana