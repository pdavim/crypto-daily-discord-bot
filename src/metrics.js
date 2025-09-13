import { Registry, collectDefaultMetrics, Counter, Histogram } from 'prom-client';

export const register = new Registry();
collectDefaultMetrics({ register });

export const fetchWithRetryCounter = new Counter({
  name: 'app_fetch_with_retry_calls_total',
  help: 'Total number of fetchWithRetry calls',
  registers: [register],
});

export const fetchWithRetryHistogram = new Histogram({
  name: 'app_fetch_with_retry_duration_seconds',
  help: 'Duration of fetchWithRetry execution in seconds',
  buckets: [0.1, 0.5, 1, 2, 5, 10],
  registers: [register],
});

export const alertCounter = new Counter({
  name: 'app_alerts_sent_total',
  help: 'Total number of alerts sent',
  registers: [register],
});

export const alertHistogram = new Histogram({
  name: 'app_alert_duration_seconds',
  help: 'Duration to send alerts in seconds',
  buckets: [0.1, 0.5, 1, 2, 5, 10],
  registers: [register],
});
