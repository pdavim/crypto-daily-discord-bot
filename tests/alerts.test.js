import { describe, it, expect } from 'vitest';
import { buildAlerts, ALERT_LEVELS, formatAlertMessage } from '../src/alerts.js';

describe('buildAlerts', () => {
  it('generates alerts based on indicator values', async () => {
    const data = {
      rsiSeries: [71],
      macdObj: { hist: [-1, 1] },
      bbWidth: [0.1],
      ma20: [1, 3],
      ma50: [2, 2],
      ma200: [5, 5],
      lastClose: 100,
      timeframe: '4h',
      timeframeVariation: 0.02,
      var24h: 0.045,
      variationByTimeframe: { '4h': 0.02, '1h': 0.015, '24h': 0.045 },
      timeframeOrder: ['4h', '1h', '30m', '15m', '5m'],
      closes: Array(20).fill(90).concat(100),
      highs: Array(21).fill(100),
      lows: Array(21).fill(80),
      volumes: Array(21).fill(1000),
      upperKC: Array(21).fill(99),
      lowerKC: Array(21).fill(80),
      adxSeries: [30]
    };
    const alerts = await buildAlerts(data);
    expect(alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({ msg: '📉 RSI>70 (sobrecompra)', level: ALERT_LEVELS.HIGH }),
      expect.objectContaining({ msg: '📈 MACD flip ↑', level: ALERT_LEVELS.MEDIUM }),
      expect.objectContaining({ msg: '📈 Golden cross 20/50', level: ALERT_LEVELS.HIGH }),
      expect.objectContaining({ msg: '📈 KC breakout above', level: ALERT_LEVELS.HIGH }),
      expect.objectContaining({ msg: '💪 ADX>25 (tendência forte)', level: ALERT_LEVELS.HIGH }),
      expect.objectContaining({ msg: '💰 Preço: 100.0000', level: ALERT_LEVELS.LOW }),
      expect.objectContaining({ msg: '📊 Variações: 4h +2.00% • 1h +1.50% • 24h +4.50%', level: ALERT_LEVELS.LOW })
    ]));

    const levels = alerts.map(alert => alert.level);
    const order = [ALERT_LEVELS.HIGH, ALERT_LEVELS.MEDIUM, ALERT_LEVELS.LOW];
    const sortedLevels = [...levels].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    expect(levels).toEqual(sortedLevels);
  });

  it('detects keltner breakout below', async () => {
    const closes = Array(20).fill(80).concat(70);
    const data = {
      rsiSeries: [50, 45],
      macdObj: { macd: [0, 0], signal: [0, 0], hist: [0, 0] },
      bbWidth: [0.1],
      ma20: [1, 1],
      ma50: [1, 1],
      ma200: [1, 1],
      lastClose: 70,
      timeframe: '4h',
      timeframeVariation: -0.05,
      var24h: -0.08,
      variationByTimeframe: { '4h': -0.05, '24h': -0.08 },
      timeframeOrder: ['4h', '1h', '30m', '15m', '5m'],
      closes,
      highs: Array(21).fill(85),
      lows: Array(21).fill(65),
      volumes: Array(21).fill(1000),
      upperKC: Array(21).fill(90),
      lowerKC: Array(21).fill(75)
    };
    const alerts = await buildAlerts(data);
    expect(alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({ msg: '📉 KC breakout below', level: ALERT_LEVELS.HIGH })
    ]));
  });

  it('detects round numbers for cheap assets', async () => {
    const lastClose = 1.005;
    const data = {
      rsiSeries: [50, 50],
      macdObj: { macd: [0, 0], signal: [0, 0], hist: [0, 0] },
      bbWidth: [0.1],
      ma20: [1, 1],
      ma50: [1, 1],
      ma200: [1, 1],
      lastClose,
      timeframe: '4h',
      timeframeVariation: 0,
      var24h: 0,
      variationByTimeframe: { '4h': 0, '24h': 0 },
      timeframeOrder: ['4h', '1h', '30m', '15m', '5m'],
      closes: Array(20).fill(lastClose).concat(lastClose),
      highs: Array(21).fill(lastClose + 1),
      lows: Array(21).fill(lastClose - 1),
      volumes: Array(21).fill(1000),
      upperKC: Array(21).fill(lastClose + 1),
      lowerKC: Array(21).fill(lastClose - 1)
    };
    const alerts = await buildAlerts(data);
    expect(alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({ msg: '🔵 Price near round number', level: ALERT_LEVELS.LOW })
    ]));
  });

  it('detects round numbers for expensive assets', async () => {
    const lastClose = 1002;
    const data = {
      rsiSeries: [50, 50],
      macdObj: { macd: [0, 0], signal: [0, 0], hist: [0, 0] },
      bbWidth: [0.1],
      ma20: [1, 1],
      ma50: [1, 1],
      ma200: [1, 1],
      lastClose,
      timeframe: '4h',
      timeframeVariation: 0,
      var24h: 0,
      variationByTimeframe: { '4h': 0, '24h': 0 },
      timeframeOrder: ['4h', '1h', '30m', '15m', '5m'],
      closes: Array(20).fill(lastClose).concat(lastClose),
      highs: Array(21).fill(lastClose + 10),
      lows: Array(21).fill(lastClose - 10),
      volumes: Array(21).fill(1000),
      upperKC: Array(21).fill(lastClose + 10),
      lowerKC: Array(21).fill(lastClose - 10)
    };
    const alerts = await buildAlerts(data);
    expect(alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({ msg: '🔵 Price near round number', level: ALERT_LEVELS.LOW })
    ]));
  });
});

describe('formatAlertMessage', () => {
  it('adds level styling to alert messages', () => {
    const formatted = formatAlertMessage({
      msg: '📈 Test alert',
      level: ALERT_LEVELS.HIGH
    });
    expect(formatted).toBe('🔴 **ALTA:** 📈 Test alert');
  });
});
