import { describe, it, expect } from 'vitest';
import { buildAlerts } from '../src/alerts.js';

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
      closes: Array(20).fill(90).concat(100),
      highs: Array(21).fill(100),
      lows: Array(21).fill(80),
      volumes: Array(21).fill(1000),
      upperKC: Array(21).fill(99),
      lowerKC: Array(21).fill(80),
      adxSeries: [30]
    };
    const alerts = await buildAlerts(data);
    expect(alerts).toContain('📉 RSI>70 (sobrecompra)');
    expect(alerts).toContain('📈 MACD flip ↑');
    expect(alerts).toContain('📈 Golden cross 20/50');
    expect(alerts).toContain('📈 KC breakout above');
    expect(alerts).toContain('💪 ADX>25 (tendência forte)');
    expect(alerts).toContain('💰 Preço: 100.0000');
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
      closes,
      highs: Array(21).fill(85),
      lows: Array(21).fill(65),
      volumes: Array(21).fill(1000),
      upperKC: Array(21).fill(90),
      lowerKC: Array(21).fill(75)
    };
    const alerts = await buildAlerts(data);
    expect(alerts).toContain('📉 KC breakout below');
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
      closes: Array(20).fill(lastClose).concat(lastClose),
      highs: Array(21).fill(lastClose + 1),
      lows: Array(21).fill(lastClose - 1),
      volumes: Array(21).fill(1000),
      upperKC: Array(21).fill(lastClose + 1),
      lowerKC: Array(21).fill(lastClose - 1)
    };
    const alerts = await buildAlerts(data);
    expect(alerts).toContain('🔵 Price near round number');
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
      closes: Array(20).fill(lastClose).concat(lastClose),
      highs: Array(21).fill(lastClose + 10),
      lows: Array(21).fill(lastClose - 10),
      volumes: Array(21).fill(1000),
      upperKC: Array(21).fill(lastClose + 10),
      lowerKC: Array(21).fill(lastClose - 10)
    };
    const alerts = await buildAlerts(data);
    expect(alerts).toContain('🔵 Price near round number');
  });
});
