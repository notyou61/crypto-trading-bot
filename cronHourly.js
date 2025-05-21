// cronHourly.js
// Executes the faux trading simulation once per hour

import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { format } from 'date-fns';

const TIMESTAMP = format(new Date(), 'yyyy-MM-dd_HH-mm-ss');
const LOG_DIR = './logs';
const LOG_FILE = path.join(LOG_DIR, `simulation_${TIMESTAMP}.log`);

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR);
}

console.log(`🚀 [${TIMESTAMP}] Starting hourly faux trade simulation...`);

exec('node fauxTradeEngine.js', (error, stdout, stderr) => {
  const output = [
    `📅 Run Time: ${TIMESTAMP}`,
    stdout,
    stderr ? `⚠️ STDERR: ${stderr}` : '',
    error ? `❌ ERROR: ${error.message}` : '',
  ].filter(Boolean).join('\n\n');

  fs.writeFileSync(LOG_FILE, output);
  console.log(`📁 Output saved to: ${LOG_FILE}`);
});
