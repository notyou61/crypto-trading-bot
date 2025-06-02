let trackedTokens = [];

export function addToken(mint, symbol = 'Unknown') {
  if (!trackedTokens.some(t => t.mint === mint)) {
    trackedTokens.push({
      mint,
      symbol,
      createdAt: Date.now(),
      retries: 0,
      priceAvailable: false,
      status: 'waiting_for_price',
      initialPrice: null
    });
  }
}

export function getWaitingTokens() {
  return trackedTokens.filter(t => t.status === 'waiting_for_price');
}

export function markAsPriced(mint, price) {
  const token = trackedTokens.find(t => t.mint === mint);
  if (token) {
    token.priceAvailable = true;
    token.price = price;
    token.status = 'ready';
  }
}

export function incrementRetry(mint) {
  const token = trackedTokens.find(t => t.mint === mint);
  if (token) token.retries++;
}

export function expireOldTokens(maxRetries = 10) {
  trackedTokens = trackedTokens.filter(t => t.retries < maxRetries);
}

export { trackedTokens }; // optional, for debugging
