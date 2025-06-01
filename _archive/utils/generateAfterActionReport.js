// utils/generateAfterActionReport.js
import fs from 'fs';
import path from 'path';

const REPORT_DIR = './utils/reports';

export default function generateAfterActionReport(data) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `meme_trader_report_${timestamp}.html`;
  const filepath = path.join(REPORT_DIR, filename);

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>MEME TRADER AFTER ACTION REPORT</title>
  <style>
    body { font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px; }
    h1 { color: #333; text-align: center; }
    table { width: 100%; border-collapse: collapse; background: #fff; }
    th, td { padding: 12px; border: 1px solid #ccc; text-align: left; }
    th { background-color: #222; color: #fff; }
    tr:nth-child(even) { background-color: #f9f9f9; }
    .summary { margin-top: 20px; font-size: 1.1em; }
  </style>
</head>
<body>
  <h1>MEME TRADER AFTER ACTION REPORT</h1>
  <p class="summary"><strong>Report Generated:</strong> ${new Date().toLocaleString()}</p>
  <table>
    <thead>
      <tr>
        <th>Token</th>
        <th>Symbol</th>
        <th>Buy Price</th>
        <th>Sell Price</th>
        <th>Profit (SOL)</th>
        <th>Exit Strategy</th>
        <th>Time Held</th>
      </tr>
    </thead>
    <tbody>
      ${data.trades.map(trade => `
        <tr>
          <td>${trade.token}</td>
          <td>${trade.symbol}</td>
          <td>${trade.buyPrice}</td>
          <td>${trade.sellPrice}</td>
          <td>${trade.profit}</td>
          <td>${trade.exitReason}</td>
          <td>${trade.holdTime}s</td>
        </tr>
      `).join('')}
    </tbody>
  </table>
  <div class="summary">
    <p><strong>Total Trades:</strong> ${data.summary.total}</p>
    <p><strong>Net Profit:</strong> ${data.summary.netProfit} SOL</p>
    <p><strong>Moonshots:</strong> ${data.summary.moonshots}</p>
    <p><strong>Average Hold Time:</strong> ${data.summary.avgHoldTime} seconds</p>
  </div>
</body>
</html>`;

  if (!fs.existsSync(REPORT_DIR)) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
  }

  fs.writeFileSync(filepath, htmlContent);
  console.log(`📄 Report saved to ${filepath}`);
}