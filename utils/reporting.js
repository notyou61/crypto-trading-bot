// utils/reporting.js
import fs from 'fs';
import path from 'path';

export function generateScalperReport(results, filenameBase = 'scalper_report') {
  const jsonPath = `${filenameBase}.json`;
  const htmlPath = `${filenameBase}.html`;

  // Save JSON
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));

  // Build simple HTML
  const htmlContent = `
  <html>
    <head><title>Scalper Bot Report</title></head>
    <body>
      <h1>Scalper Bot Report</h1>
      <pre>${JSON.stringify(results, null, 2)}</pre>
    </body>
  </html>
  `;
  fs.writeFileSync(htmlPath, htmlContent);

  return { jsonPath, htmlPath };
}
