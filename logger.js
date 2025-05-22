// logger.js
import fs from 'fs';

export function logTrade(entry) {
  const line = `[${new Date().toISOString()}] ${entry}\n`;
  fs.appendFileSync('trade.log', line);
}

export function logError(message, err = null) {
  const line = `[${new Date().toISOString()}] ❌ ${message}${err ? ' | ' + err.message : ''}\n`;
  fs.appendFileSync('errors.log', line);
}

