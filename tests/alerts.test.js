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
});
