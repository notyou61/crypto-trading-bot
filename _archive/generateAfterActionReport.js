import fs from 'fs';
import path from 'path';

const REPORT_DIR = './utils/reports';

export default function generateAfterActionReport(trades, summary) {
  if (!fs.existsSync(REPORT_DIR)) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `meme_trader_report_${timestamp}.html`;
  const filepath = path.join(REPORT_DIR, filename);

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>MEME TRADER AFTER ACTION REPORT</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f4f4f4; padding: 20px; }
    h1 { color: #222; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { padding: 10px; border: 1px solid #ccc; }
    th { background: #222; color: #fff; }
    tr:nth-child(even) { background: #eee; }
  </style>
</head>
<body>
  <h1>MEME TRADER AFTER ACTION REPORT</h1>
  <p><strong>Total Trades:</strong> ${summary.totalTrades}</p>
  <p><strong>Net Profit (SOL):</strong> ${summary.totalProfit.toFixed(4)}</p>
  <p><strong>Session Time:</strong> ${summary.runTime}</p>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Token</th>
        <th>Buy Price</th>
        <th>Sell Price</th>
        <th>Profit (SOL)</th>
        <th>Exit Type</th>
      </tr>
    </thead>
    <tbody>
      ${trades.map((t, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${t.token}</td>
          <td>${t.buyPrice.toFixed(6)}</td>
          <td>${t.sellPrice.toFixed(6)}</td>
          <td>${t.profit.toFixed(4)}</td>
          <td>${t.exitType}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>
</body>
</html>`;

  fs.writeFileSync(filepath, htmlContent);
  console.log(`📄 After Action Report saved to: ${filepath}`);
}
