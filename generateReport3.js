// generateReport2.js (only showing modified `generateReport` function; rest unchanged)
async function generateReport(tokens) {
  if (!tokens.length) {
    console.warn('WARN: No tokens fetched; generating empty report');
    return;
  }

  const solPrice = (await getSolPrice()) || config.FALLBACK_SOL_PRICE;
  console.log(`INFO: Current SOL Price (USD): ${solPrice.toFixed(2)}`);
  const priceWarning =
    solPrice === config.FALLBACK_SOL_PRICE
      ? '<p><strong>Warning:</strong> Using fallback SOL price ($100.00) due to API failure.</p>'
      : '';
  const tradedTokens = tokens.filter((t) => t.tradeTaken);
  const gainList = tradedTokens.map(t => parseFloat(t.profitGain));

  // Dynamically update tier assignments with rarity context
  tokens.forEach(t => {
    const rarityScore = rarityIndex(gainList, parseFloat(t.profitGain));
    t.tier = assignTier(parseFloat(t.profitGain), rarityScore);
  });

  const tiers = ['Skipped', 'Pulse', 'Moonshot', 'Supermoon', 'Nova', 'Black Hole'];
  const calculateProfit = (token) => (token.exitPrice - token.initialPrice) * config.TRADE_QUANTITY;

  // Tier data
  const tierData = tiers.reduce((acc, tier) => {
    const group = tokens.filter(t => (tier === 'Skipped' ? !t.tradeTaken : t.tier === tier && t.tradeTaken));
    const profitUsd = group.reduce((sum, t) => sum + calculateProfit(t), 0);
    acc[tier] = {
      count: group.length,
      profitUsd,
      profitSol: profitUsd / solPrice,
      share: tokens.length ? (group.length / tokens.length * 100) : 0
    };
    return acc;
  }, {});

  // Load or initialize snowball state
  let snowballState = {
    bankroll: 0.1,
    status: 'active',
    tradesExecuted: 0,
    target: 5.0,
    lastUpdated: new Date().toISOString()
  };
  try {
    const existing = await fs.readFile(config.SNOWBALL_STATE_PATH, 'utf8');
    snowballState = JSON.parse(existing);
    console.log(`INFO: Loaded Snowball state: ${snowballState.bankroll} SOL`);
  } catch {
    console.warn('WARN: Starting fresh Snowball state');
  }

  // Capture starting bankroll for accurate reporting
  const startingSnowballBankroll = snowballState.bankroll;

  // Initialize or load persistent wallet balances
  let walletState = {
    hotWallet: 0.1,
    payoutWallet: 0.0,
    coldWallet: 0.0,
    spendingWallet: 0.0,
    lastUpdated: new Date().toISOString()
  };
  try {
    const raw = await fs.readFile(config.BALANCE_STATE_PATH, 'utf8');
    walletState = JSON.parse(raw);
    console.log(`INFO: Loaded wallet balances:`, walletState);
  } catch {
    console.log('INFO: No balance state found. Starting fresh.');
  }

  let currentSol = snowballState.bankroll;
  let snowballProfit = 0;

  // Debug: Log trade details to verify snowballProfit
  console.log(`INFO: Starting Snowball simulation with ${tradedTokens.length} trades, initial bankroll: ${currentSol.toFixed(4)} SOL`);

  // Only run Snowball simulation if starting bankroll is below target
  if (startingSnowballBankroll < snowballState.target) {
    for (const token of tradedTokens) {
      if (snowballState.status !== 'active') break;

      const tradeSize = Math.min(currentSol, config.MAX_TRADE_SIZE);
      const qty = tradeSize / token.initialPrice;
      const returnSol = qty * token.exitPrice;
      const profit = returnSol - tradeSize;

      console.log(`INFO: Trade - Token: ${token.token}, Trade Size: ${tradeSize.toFixed(4)} SOL, Profit: ${profit.toFixed(4)} SOL`);

      currentSol += profit;
      snowballProfit += profit;
      token.bankrollAfterTrade = parseFloat(currentSol.toFixed(6));
      snowballState.tradesExecuted++;

      if (currentSol >= snowballState.target) {
        snowballState.status = 'reserve_mode';
        console.log(`🎯 Snowball complete — switching to Reserve Mode`);
        break;
      }
    }
  } else {
    console.log(`INFO: Starting bankroll (${startingSnowballBankroll.toFixed(4)} SOL) at or above target (${snowballState.target} SOL). Operating in Reserve Mode.`);
    snowballProfit = tradedTokens.reduce((sum, token) => {
      const tradeSize = Math.min(currentSol, config.MAX_TRADE_SIZE);
      const qty = tradeSize / token.initialPrice;
      const returnSol = qty * token.exitPrice;
      const profit = returnSol - tradeSize;
      console.log(`INFO: Trade - Token: ${token.token}, Trade Size: ${tradeSize.toFixed(4)} SOL, Profit: ${profit.toFixed(4)} SOL`);
      return sum + profit;
    }, 0);
    currentSol += snowballProfit;
    snowballState.tradesExecuted += tradedTokens.length;
    snowballState.status = 'reserve_mode';
  }

  console.log(`INFO: Snowball Profit: ${snowballProfit.toFixed(4)} SOL, Final Bankroll: ${currentSol.toFixed(4)} SOL`);

  // Calculate total theoretical profit (all trades, including skipped)
  const totalProfitUsd = tradedTokens.reduce((sum, t) => sum + calculateProfit(t), 0);
  const totalProfitSol = totalProfitUsd / solPrice;

  // Profit Distribution (Reserve Mode)
  let reserveSummary = '';
  let spendingPayout = '';
  let toHot = 0, toSpending = 0, toPayout = 0, toCold = 0;
  if (snowballState.status === 'reserve_mode') {
    const dailyUsdTarget = config.SPENDING_WALLET_HOURLY_USD * config.HOURS_PER_DAY;
    const usdProfit = snowballProfit * solPrice;
    const solProfit = snowballProfit;

    const profit25 = solProfit * 0.25;
    const profit50 = solProfit * 0.50;

    const maxSpendingSOL = MAX_SPENDING_USD / solPrice;
    const currentSpendingSOL = walletState.spendingWallet;
    const spendingGap = Math.max(0, maxSpendingSOL - currentSpendingSOL);

    if (walletState.hotWallet < MAX_HOT_WALLET_SOL) {
      const neededToReachTarget = MAX_HOT_WALLET_SOL - walletState.hotWallet;
      toHot = Math.min(solProfit, neededToReachTarget);
      walletState.hotWallet += toHot;
      const remainingProfit = solProfit - toHot;

      toSpending = Math.min(remainingProfit * 0.25, spendingGap);
      toPayout = remainingProfit * 0.25;
      toCold = remainingProfit * 0.50;

      walletState.spendingWallet += toSpending;
      walletState.payoutWallet += toPayout;
      walletState.coldWallet += toCold;

      console.log(`💸 Profit Routed (Hot Wallet Growing):`);
      console.log(`- Hot Wallet: ${toHot.toFixed(4)} SOL (target ${MAX_HOT_WALLET_SOL} SOL)`);
      console.log(`- Spending Wallet: ${toSpending.toFixed(4)} SOL (gap ${spendingGap.toFixed(4)} SOL)`);
      console.log(`- Payout Wallet: ${toPayout.toFixed(4)} SOL`);
      console.log(`- Cold Wallet: ${toCold.toFixed(4)} SOL`);
    } else {
      toSpending = Math.min(profit25, spendingGap);
      const spendingDeficit = profit25 - toSpending;

      toPayout = profit25 + (spendingDeficit * 0.5);
      toCold = profit50 + (spendingDeficit * 0.5);

      walletState.spendingWallet += toSpending;
      walletState.payoutWallet += toPayout;
      walletState.coldWallet += toCold;

      console.log(`💸 Profit Routed (Hot Wallet Capped):`);
      console.log(`- Hot Wallet: ${toHot.toFixed(4)} SOL (capped at ${MAX_HOT_WALLET_SOL} SOL)`);
      console.log(`- Spending Wallet: ${toSpending.toFixed(4)} SOL (gap ${spendingGap.toFixed(4)} SOL)`);
      console.log(`- Payout Wallet: ${toPayout.toFixed(4)} SOL (includes ${spendingDeficit.toFixed(4)} SOL deficit)`);
      console.log(`- Cold Wallet: ${toCold.toFixed(4)} SOL (includes ${spendingDeficit.toFixed(4)} SOL deficit)`);
    }

    if (walletState.hotWallet < MIN_HOT_WALLET_SOL) {
      console.warn(`⚠️ Hot Wallet dropped below ${MIN_HOT_WALLET_SOL} SOL. Adjusting.`);
      const shortfall = MIN_HOT_WALLET_SOL - walletState.hotWallet;
      walletState.hotWallet = MIN_HOT_WALLET_SOL;
      if (walletState.payoutWallet >= shortfall) {
        walletState.payoutWallet -= shortfall;
        toPayout -= shortfall;
        console.log(`INFO: Transferred ${shortfall.toFixed(4)} SOL from Payout Wallet to Hot Wallet.`);
      } else if (walletState.coldWallet >= shortfall) {
        walletState.coldWallet -= shortfall;
        toCold -= shortfall;
        console.log(`INFO: Transferred ${shortfall.toFixed(4)} SOL from Cold Wallet to Hot Wallet.`);
      } else {
        console.warn(`WARN: Insufficient funds in Payout (${walletState.payoutWallet.toFixed(4)} SOL) and Cold (${walletState.coldWallet.toFixed(4)} SOL) to cover shortfall of ${shortfall.toFixed(4)} SOL.`);
      }
    }

    walletState.hotWallet = Math.min(walletState.hotWallet, MAX_HOT_WALLET_SOL);

    const newSpendingSol = walletState.spendingWallet;
    const newSpendingUsd = newSpendingSol * solPrice;
    if (newSpendingSol >= maxSpendingSOL) {
      spendingPayout = `<p><strong>Spending Payout:</strong> Spending Wallet at or above $${MAX_SPENDING_USD.toFixed(2)} cap (${newSpendingSol.toFixed(4)} SOL ~ $${newSpendingUsd.toFixed(2)}).</p>`;
    } else if (toSpending > 0) {
      spendingPayout = `<p><strong>Spending Payout:</strong> Transferred ${toSpending.toFixed(4)} SOL (~$${(toSpending * solPrice).toFixed(2)}) to Spending Wallet. Still needs ${(maxSpendingSOL - newSpendingSol).toFixed(4)} SOL (~$${(maxSpendingSOL * solPrice - newSpendingUsd).toFixed(2)}) to reach $${MAX_SPENDING_USD.toFixed(2)} cap.</p>`;
    } else {
      spendingPayout = `<p><strong>Spending Payout:</strong> No transfer to Spending Wallet. Gap: ${(maxSpendingSOL - newSpendingSol).toFixed(4)} SOL (~$${(maxSpendingSOL * solPrice - newSpendingUsd).toFixed(2)}) to reach $${MAX_SPENDING_USD.toFixed(2)} cap.</p>`;
    }

    walletState.lastUpdated = new Date().toISOString();
    try {
      await fs.mkdir(path.dirname(config.BALANCE_STATE_PATH), { recursive: true });
      await fs.writeFile(config.BALANCE_STATE_PATH, JSON.stringify(walletState, null, 2));
      console.log('📘 Wallet state saved:', config.BALANCE_STATE_PATH);
    } catch (err) {
      console.error(`ERROR: Failed to save wallet state: ${err.message}`);
    }

    const targetMet = usdProfit >= dailyUsdTarget;
    console.log(
      `${targetMet ? '✅' : '🕒'} ${targetMet ? 'Daily income target met' : 'Income below target'}: $${usdProfit.toFixed(2)} (${targetMet ? '≥' : '<'} $${dailyUsdTarget})`
    );

    await logProfitDistribution(solPrice, solProfit, usdProfit, toHot, toSpending, toPayout, toCold, config);

    reserveSummary = `
      <p><strong>Reserve Mode:</strong> Processed profit of <span class="highlight">${snowballProfit.toFixed(4)} SOL</span> (~$${(snowballProfit * solPrice).toFixed(2)}) distributed as:</p>
      <ul>
        <li><strong>Hot Wallet</strong>: ${toHot.toFixed(4)} SOL (~$${(toHot * solPrice).toFixed(2)})</li>
        <li><strong>Spending Wallet</strong>: ${toSpending.toFixed(4)} SOL (~$${(toSpending * solPrice).toFixed(2)})</li>
        <li><strong>Payout Wallet</strong>: ${toPayout.toFixed(4)} SOL (~$${(toPayout * solPrice).toFixed(2)})</li>
        <li><strong>Cold Storage</strong>: ${toCold.toFixed(4)} SOL (~$${(toCold * solPrice).toFixed(2)})</li>
      </ul>
      <p><strong>Wallet Balances</strong> (Cumulative):</p>
      <ul>
        <li><strong>Hot Wallet</strong>: ${walletState.hotWallet.toFixed(4)} SOL (~$${(walletState.hotWallet * solPrice).toFixed(2)})</li>
        <li><strong>Spending Wallet</strong>: ${walletState.spendingWallet.toFixed(4)} SOL (~$${(walletState.spendingWallet * solPrice).toFixed(2)})</li>
        <li><strong>Payout Wallet</strong>: ${walletState.payoutWallet.toFixed(4)} SOL (~$${(walletState.payoutWallet * solPrice).toFixed(2)})</li>
        <li><strong>Cold Storage</strong>: ${walletState.coldWallet.toFixed(4)} SOL (~$${(walletState.coldWallet * solPrice).toFixed(2)})</li>
      </ul>
      <p><strong>Daily Income Target</strong>: $${usdProfit.toFixed(2)} ${targetMet ? 'meets' : 'falls short of'} $${dailyUsdTarget}.</p>
      ${spendingPayout}
    `;
  }

  // Save snowball state
  snowballState.bankroll = parseFloat(currentSol.toFixed(6));
  snowballState.lastUpdated = new Date().toISOString();
  try {
    await fs.mkdir(path.dirname(config.SNOWBALL_STATE_PATH), { recursive: true });
    await fs.writeFile(config.SNOWBALL_STATE_PATH, JSON.stringify(snowballState, null, 2));
    console.log('✅ Snowball state saved.');
  } catch (err) {
    console.error(`ERROR: Failed to save snowball state: ${err.message}`);
  }

  // Aggregate metrics
  const priceRange = calculateRange(tradedTokens, 'initialPrice');
  const peakPriceRange = calculateRange(tradedTokens, 'peakPrice');
  const timeToPeakRange = calculateRange(tradedTokens, 'timeToPeakMs');
  const profitGainRange = {
    min: tradedTokens.length ? Math.min(...tradedTokens.map((t) => parseFloat(t.profitGain))) : 0,
    max: tradedTokens.length ? Math.max(...tradedTokens.map((t) => parseFloat(t.profitGain))) : 0,
  };
  const triggerRange = calculateRange(tradedTokens, 'triggeredAtMs');
  const sortedTimestamps = tokens.map((t) => new Date(t.launchTimestamp)).sort((a, b) => a - b);
  const formattedTimeRange = tokens.length
    ? `${sortedTimestamps[0]?.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })} to ${sortedTimestamps[sortedTimestamps.length - 1]?.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })}`
    : 'N/A (no tokens fetched)';

  console.log('Profit Summary by Tier:', tierData);
  console.log('This Run Theoretical Profit (All Trades):', totalProfitUsd.toFixed(4), 'USD', totalProfitSol.toFixed(6), 'SOL');
  console.log(
    snowballState.status === 'reserve_mode' && startingSnowballBankroll >= snowballState.target
      ? `Reserve Mode: Processed ${snowballProfit.toFixed(4)} SOL profit in ${snowballState.tradesExecuted} trades`
      : `Snowball Mode: Starting from ${startingSnowballBankroll.toFixed(4)} SOL, reached ${currentSol.toFixed(4)} SOL with ${snowballProfit.toFixed(4)} SOL profit in ${snowballState.tradesExecuted} trades`
  );

  // HTML report
  const snowballSummary = startingSnowballBankroll < snowballState.target
    ? `<p><strong>Snowball Mode:</strong> Started at <span class="highlight">${startingSnowballBankroll.toFixed(4)} SOL</span>, reached <span class="highlight">${currentSol.toFixed(4)} SOL</span>, generating <span class="highlight">${snowballProfit.toFixed(4)} SOL</span> (~$${(snowballProfit * solPrice).toFixed(2)}) in ${snowballState.tradesExecuted} trades.</p>`
    : `<p><strong>Reserve Mode:</strong> Started at <span class="highlight">${startingSnowballBankroll.toFixed(4)} SOL</span>, processed <span class="highlight">${snowballProfit.toFixed(4)} SOL</span> (~$${(snowballProfit * solPrice).toFixed(2)}) in ${snowballState.tradesExecuted} trades.</p>`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Memecoin Trading Bot Historical Report</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            background-color: #f5f5f5;
            color: #333;
            margin: 0;
            padding: 20px;
            line-height: 1.6;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            background-color: #fff;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
        }
        h1, h2, h3 {
            color: #0077b6;
        }
        h1 {
            text-align: center;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }
        th, td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }
        th {
            background-color: #e6f0fa;
            color: #0077b6;
        }
        tr:hover {
            background-color: #f0f4f8;
        }
        ul, li {
            margin: 5px 0;
        }
        .section {
            margin: 20px 0;
        }
        .summary {
            padding: 15px;
            background-color: #f9f9f9;
            border-radius: 8px;
        }
        .highlight {
            color: #00a86b;
            font-weight: bold;
        }
        .emoji {
            margin-right: 10px;
        }
        .token-address {
            font-family: monospace;
            word-break: break-all;
        }
        a.token-address {
            color: #0077b6;
            text-decoration: none;
        }
        a.token-address:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Memecoin Trading Bot Historical Report</h1>

        <div class="section summary">
            <h2><span class="emoji">📝</span> Summary</h2>
            ${priceWarning}
            <p>Analyzed <span class="highlight">${tokens.length} tokens</span> launched between <span class="highlight">${formattedTimeRange}</span>. Executed <span class="highlight">${tradedTokens.length} trades</span>, skipped <span class="highlight">${tierData.Skipped.count} trades</span>.</p>
            <p>Theoretical profit from executed trades: <span class="highlight">$${totalProfitUsd.toFixed(2)}</span> (<span class="highlight">${totalProfitSol.toFixed(4)} SOL</span>) at SOL price <span class="highlight">$${solPrice.toFixed(2)}</span>.</p>
            ${snowballSummary}
            ${reserveSummary}
        </div>

        <div class="section">
            <h2><span class="emoji">✅</span> Overview</h2>
            <ul>
                <li><strong>Total Tokens Analyzed</strong>: ${tokens.length}</li>
                <li><strong>Trades Executed</strong>: ${tradedTokens.length}</li>
                <li><strong>Current SOL Price</strong>: $${solPrice.toFixed(2)}</li>
                <li><strong>Theoretical Total Profit</strong>:
                    <ul>
                        <li><strong>USD</strong>: $${totalProfitUsd.toFixed(2)}</li>
                        <li><strong>SOL</strong>: ${totalProfitSol.toFixed(4)}</li>
                    </ul>
                </li>
            </ul>
        </div>

        <div class="section">
            <h2><span class="emoji">📊</span> Tier Breakdown</h2>
            <table>
                <tr>
                    <th>Tier</th>
                    <th>Count</th>
                    <th>Profit (USD)</th>
                    <th>Profit (SOL)</th>
                    <th>Share of Trades</th>
                </tr>
                ${tiers
                  .map(
                    (tier) => `
                    <tr>
                        <td>${tier}</td>
                        <td>${tierData[tier].count}</td>
                        <td>$${tierData[tier].profitUsd.toFixed(2)}</td>
                        <td>${tierData[tier].profitSol.toFixed(4)}</td>
                        <td>${tierData[tier].share.toFixed(2)}%</td>
                    </tr>
                `
                  )
                  .join('')}
            </table>
        </div>

        <div class="section">
            <h2><span class="emoji">📈</span> Tier Summaries</h2>
            ${tiers
              .map((tier) => {
                const tierTokens = tokens.filter((t) => t.tier === tier && t.tradeTaken);
                if (!tierTokens.length)
                  return `
                <h3>${tier}</h3>
                <p>No tokens in the <span class="highlight">${tier}</span> tier.</p>
              `;
                return `
                <h3>${tier}</h3>
                <p><span class="highlight">${tierTokens.length} token${tierTokens.length > 1 ? 's' : ''}</span> in the <span class="highlight">${tier}</span> tier contributed <span class="highlight">$${tierData[tier].profitUsd.toFixed(2)}</span> (<span class="highlight">${tierData[tier].profitSol.toFixed(4)} SOL</span>), representing <span class="highlight">${tierData[tier].share.toFixed(2)}%</span> of trades. Initial prices ranged from <span class="highlight">$${calculateRange(tierTokens, 'initialPrice').min.toFixed(6)}</span> to <span class="highlight">$${calculateRange(tierTokens, 'initialPrice').max.toFixed(6)}</span>, peaking at <span class="highlight">$${calculateRange(tierTokens, 'peakPrice').min.toFixed(6)}</span> to <span class="highlight">$${calculateRange(tierTokens, 'peakPrice').max.toFixed(6)}</span> in <span class="highlight">${calculateRange(tierTokens, 'timeToPeakMs').min.toFixed(0)}–${calculateRange(tierTokens, 'timeToPeakMs').max.toFixed(0)} seconds</span> for gains up to <span class="highlight">${tierTokens.length ? Math.max(...tierTokens.map((t) => t.peakPrice / t.initialPrice)).toFixed(1) : 0}x</span>.</p>
              `;
              })
              .join('')}
        </div>

        ${tokens
          .map(
            (token, index) => `
          <div class="section">
            <h2><span class="emoji">📘</span> Token Details: Token ${index + 1}</h2>
            <table>
              <tr><th>Metric</th><th>Value</th></tr>
              <tr><td>Token</td><td><a class="token-address" href="https://pump.fun/coin/${token.token}" target="_blank">${token.token}</a></td></tr>
              <tr><td>Launch Timestamp</td><td>${token.launchTimestamp}</td></tr>
              <tr><td>Initial Price</td><td>${formatPrice(token.initialPrice, token.initialPrice / solPrice)}</td></tr>
              <tr><td>Peak Price</td><td>${formatPrice(token.peakPrice, token.peakPrice / solPrice)}</td></tr>
              <tr><td>Peak Gain</td><td>${(token.peakPrice / token.initialPrice).toFixed(1)}x</td></tr>
              <tr><td>Time to Peak</td><td>${msToSeconds(token.timeToPeakMs)} seconds</td></tr>
              <tr><td>Collapse Time</td><td>${msToSeconds(token.collapseTimeMs)} seconds</td></tr>
              <tr><td>Buyers (10s)</td><td>${token.buyers10s}</td></tr>
              <tr><td>Buyers (30s)</td><td>${token.buyers30s}</td></tr>
              <tr><td>Hold Duration</td><td>${token.holdDuration.toFixed(2)} seconds</td></tr>
              <tr><td>Exit Price</td><td>${formatPrice(token.exitPrice, token.exitPrice / solPrice)}</td></tr>
              <tr><td>Profit Gain</td><td>${token.profitGain}%</td></tr>
              <tr><td>Profit</td><td>${formatPrice(calculateProfit(token), calculateProfit(token) / solPrice)}</td></tr>
              <tr><td>Tier</td><td>${token.tradeTaken ? token.tier : 'Skipped'}</td></tr>
              <tr><td>Trade Taken</td><td>${token.tradeTaken}</td></tr>
              <tr><td>Triggered At</td><td>${msToSeconds(token.triggeredAtMs)} seconds</td></tr>
              <tr><td>Notes</td><td>${token.notes}</td></tr>
              ${token.bankrollAfterTrade ? `<tr><td>Bankroll After Trade</td><td>${token.bankrollAfterTrade} SOL</td></tr>` : ''}
            </table>
          </div>
        `
          )
          .join('')}
    </div>
</body>
</html>
`;

  try {
    await fs.writeFile(config.OUTPUT_HTML, html); // Fixed OUTPUT_PATH to OUTPUT_HTML
    console.log(`SUCCESS: HTML report generated at ${config.OUTPUT_HTML}`);
  } catch (err) {
    console.error(`ERROR: Error writing HTML: ${err.message}`);
    throw err;
  }
}