import { describe, it, expect } from 'vitest';
import { buildAlerts } from '../src/alerts.js';

describe('buildAlerts', () => {
  it('generates alerts based on indicator values', () => {
    const data = {
      rsiSeries: [71],
      macdObj: { hist: [-1, 1] },
      bbWidth: [0.1],
      ma20: [1, 3],
      ma50: [2, 2],
      ma200: [5, 5],
      lastClose: 100,
      closes: Array(20).fill(90).concat(100),
      highs: Array(20).fill(100),
      lows: Array(20).fill(80),
      volumes: Array(20).fill(1000)
    };
    const alerts = buildAlerts(data);
    expect(alerts).toContain('📉 RSI>70 (sobrecompra)');
    expect(alerts).toContain('📈 MACD flip ↑');
    expect(alerts).toContain('📈 Golden cross 20/50');
    expect(alerts).toContain('💰 Preço: 100.0000');
  });
  
  it('detects round numbers for cheap assets', () => {
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
      highs: Array(20).fill(lastClose + 1),
      lows: Array(20).fill(lastClose - 1),
      volumes: Array(20).fill(1000)
    };
    const alerts = buildAlerts(data);
    expect(alerts).toContain('🔵 Price near round number');
  });

  it('detects round numbers for expensive assets', () => {
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
      highs: Array(20).fill(lastClose + 10),
      lows: Array(20).fill(lastClose - 10),
      volumes: Array(20).fill(1000)
    };
    const alerts = buildAlerts(data);
    expect(alerts).toContain('🔵 Price near round number');
  });
});
