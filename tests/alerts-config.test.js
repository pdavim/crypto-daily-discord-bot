import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { buildAlerts } from '../src/alerts.js';
import { CFG } from '../src/config.js';

const cloneThresholds = () => ({ ...CFG.alertThresholds });

const createBaseData = () => ({
  rsiSeries: [50, 50],
  macdObj: { macd: [0, 0], signal: [0, 0], hist: [0, 0] },
  bbWidth: [0.1, 0.1],
  ma20: [100, 100],
  ma50: [100, 100],
  ma200: [100, 100],
  lastClose: 100,
  timeframe: '4h',
  timeframeVariation: 0,
  closes: Array(21).fill(100),
  highs: Array(21).fill(101),
  lows: Array(21).fill(99),
  volumes: Array(21).fill(1000),
  upperBB: Array(21).fill(101),
  lowerBB: Array(21).fill(99),
  atrSeries: Array(21).fill(1),
  upperKC: Array(21).fill(101),
  lowerKC: Array(21).fill(99),
  adxSeries: Array(21).fill(10),
  sarSeries: Array(21).fill(90),
  trendSeries: Array(21).fill(0),
  heuristicSeries: Array(21).fill(50),
  vwapSeries: Array(21).fill(100),
  ema9: Array(21).fill(100),
  ema21: Array(21).fill(100),
  stochasticK: Array(21).fill(50),
  stochasticD: Array(21).fill(50),
  willrSeries: Array(21).fill(-50),
  cciSeries: Array(21).fill(0),
  obvSeries: Array(21).fill(1000),
  var24h: 0,
  variationByTimeframe: { '4h': 0, '24h': 0 },
  timeframeOrder: ['4h', '1h', '30m', '15m', '5m'],
  equity: 1000,
  riskPct: 0.01
});

describe('buildAlerts configuration', () => {
  let originalThresholds;

  beforeEach(() => {
    originalThresholds = cloneThresholds();
  });

  afterEach(() => {
    Object.assign(CFG.alertThresholds, originalThresholds);
  });

  it('respects configurable RSI overbought threshold', async () => {
    const data = createBaseData();
    data.rsiSeries = [65];

    const defaultAlerts = await buildAlerts(data);
    expect(defaultAlerts.map(alert => alert.msg)).not.toContain('📉 RSI>70 (sobrecompra)');

    CFG.alertThresholds.rsiOverbought = 60;
    const customAlerts = await buildAlerts(data);
    expect(customAlerts.map(alert => alert.msg)).toContain('📉 RSI>70 (sobrecompra)');
  });

  it('respects configurable volume spike multiplier', async () => {
    const data = createBaseData();
    data.volumes = Array(20).fill(1000).concat(1500);

    const defaultAlerts = await buildAlerts(data);
    expect(defaultAlerts.map(alert => alert.msg)).not.toContain('🔊 Volume spike (>2x avg)');

    CFG.alertThresholds.volumeSpike = 1.4;
    const customAlerts = await buildAlerts(data);
    expect(customAlerts.map(alert => alert.msg)).toContain('🔊 Volume spike (>2x avg)');
  });
});

