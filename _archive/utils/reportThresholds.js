// utils/reportThresholds.js
export function shouldTriggerReport(tradeHistory, lastReportTime) {
  const now = Date.now();
  const elapsedMinutes = (now - lastReportTime) / 1000 / 60;
  const soldTrades = tradeHistory.filter(t => t.exitPrice).length;
  return tradeHistory.length >= 10 && soldTrades >= 3 && elapsedMinutes >= 15;
}