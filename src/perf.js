import { logger, withContext } from './logger.js';

const stats = {
  fetchOHLCV: [],
  buildAlerts: [],
  renderChartPNG: [],
};

export function recordPerf(name, ms) {
  if (!stats[name]) stats[name] = [];
  stats[name].push(ms);
}

export function reportWeeklyPerf() {
  const averages = {};
  for (const [name, arr] of Object.entries(stats)) {
    const avg = arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    averages[name] = avg;
    stats[name] = [];
  }
  const log = withContext(logger);
  log.info({ fn: 'weeklyPerf', averages }, 'Weekly performance averages (ms)');
  return averages;
}
