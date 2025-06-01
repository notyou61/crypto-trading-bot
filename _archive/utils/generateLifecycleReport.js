// utils/generateLifecycleReport.js
async function generateLifecycleReport(entries) {
  let html = `
    <html>
      <head>
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <style>
          body { font-family: Arial, sans-serif; }
          h1 { text-align: center; }
          h2 { color: #333; }
          canvas { max-width: 400px; margin: 10px 0; }
        </style>
      </head>
      <body>
        <h1>Token Lifecycle Report</h1>
  `;

  for (const [token, data] of entries) {
    html += `<h2>Token: ${token}</h2>`;
    html += `<p>Rug Status: ${data.isRugged ? 'Rugged' : 'Active'}</p>`;

    // Price History
    html += `<h3>Price History</h3>`;
    if (!data.priceHistory || data.priceHistory.length === 0) {
      html += '<p>No price data available</p>';
    } else {
      html += '<ul>';
      for (const { t, price } of data.priceHistory) {
        html += `<li>${new Date(t).toISOString()}: ${price.toFixed(8)}</li>`;
      }
      html += '</ul>';
      html += `<canvas id="priceChart-${token}" width="400" height="200"></canvas>`;
      html += `
        <script>
          new Chart(document.getElementById('priceChart-${token}'), {
            type: 'line',
            data: {
              labels: [${data.priceHistory.map((p) => `'${new Date(p.t).toISOString()}'`).join(',')}],
              datasets: [{
                label: 'Price',
                data: [${data.priceHistory.map((p) => p.price).join(',')}],
                borderColor: 'blue',
                fill: false
              }]
            },
            options: { scales: { y: { beginAtZero: true } } }
          });
        </script>
      `;
    }

    // Buyer History
    html += `<h3>Buyer History</h3>`;
    if (!data.buyerHistory || data.buyerHistory.length === 0) {
      html += '<p>No buyer data available</p>';
    } else {
      html += '<ul>';
      for (const { t, count } of data.buyerHistory) {
        html += `<li>${new Date(t).toISOString()}: ${count} buyers</li>`;
      }
      html += '</ul>';
      html += `<canvas id="buyerChart-${token}" width="400" height="200"></canvas>`;
      html += `
        <script>
          new Chart(document.getElementById('buyerChart-${token}'), {
            type: 'line',
            data: {
              labels: [${data.buyerHistory.map((b) => `'${new Date(b.t).toISOString()}'`).join(',')}],
              datasets: [{
                label: 'Buyers',
                data: [${data.buyerHistory.map((b) => b.count).join(',')}],
                borderColor: 'green',
                fill: false
              }]
            },
            options: { scales: { y: { beginAtZero: true } } }
          });
        </script>
      `;
    }
  }

  html += '</body></html>';
  return html;
}

export { generateLifecycleReport };