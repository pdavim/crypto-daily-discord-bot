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

export const forecastConfidenceHistogram = new Histogram({
  name: 'app_forecast_confidence',
  help: 'Confidence assigned to generated forecasts',
  buckets: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
  registers: [register],
});

export const forecastErrorHistogram = new Histogram({
  name: 'app_forecast_absolute_percentage_error',
  help: 'Absolute percentage error between forecast and realized close prices',
  buckets: [0.001, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2],
  registers: [register],
});

export const forecastDirectionCounter = new Counter({
  name: 'app_forecast_direction_hits_total',
  help: 'Counts of forecast direction hits versus misses',
  labelNames: ['outcome'],
  registers: [register],
});

export const tradingExecutionCounter = new Counter({
  name: 'app_trading_execution_total',
  help: 'Automated trading execution outcomes',
  labelNames: ['action', 'result'],
  registers: [register],
});

export const tradingNotionalHistogram = new Histogram({
  name: 'app_trading_notional_size',
  help: 'Notional size of executed automated trades',
  buckets: [10, 25, 50, 100, 250, 500, 1_000, 5_000, 10_000, 50_000, 100_000],
  registers: [register],
});
