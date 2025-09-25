import { logger, withContext } from "./logger.js";

const stats = {
  fetchOHLCV: [],
  buildAlerts: [],
  renderChartPNG: [],
};

/**
 * Records a performance metric sample for later aggregation.
 * @param {string} name - Metric identifier.
 * @param {number} ms - Duration in milliseconds.
 */
export function recordPerf(name, ms) {
  if (!stats[name]) stats[name] = [];
  stats[name].push(ms);
}

/**
 * Summarizes and resets the collected performance metrics.
 * @returns {Object} Aggregated statistics per metric.
 */
export function reportWeeklyPerf() {
  const summary = {};
  for (const [name, arr] of Object.entries(stats)) {
    const count = arr.length;
    const avg = count ? arr.reduce((a, b) => a + b, 0) / count : 0;
    summary[name] = { avg, count };
    stats[name] = [];
  }
  const log = withContext(logger);
  log.debug({ fn: 'weeklyPerf', summary }, 'Weekly performance averages (ms)');
  return summary;
}
