import { describe, it, expect } from 'vitest';
import { buildSnapshotForReport, buildSummary } from '../src/reporter.js';

describe('reporter', () => {
  it('builds snapshot and summary from OHLCV data', () => {
    const candles4h = [
      { o: 90, h: 110, l: 85, c: 100, v: 1000 },
      { o: 100, h: 115, l: 95, c: 110, v: 1500 }
    ];
    const candles1h = [
      { o: 50, h: 55, l: 49, c: 54, v: 500 },
      { o: 54, h: 56, l: 53, c: 55, v: 600 }
    ];
    const daily = [
      { t: new Date('2022-12-04T00:00:00Z'), c: 10 },
      { t: new Date('2022-12-27T00:00:00Z'), c: 50 },
      { t: new Date('2023-01-02T00:00:00Z'), c: 100 },
      { t: new Date('2023-01-03T00:00:00Z'), c: 110 }
    ];

    const snapshot4h = buildSnapshotForReport({
      candles: candles4h,
      daily,
      ma20: [100, 108],
      ma50: [95, 105],
      ma100: [90, 100],
      ma200: [80, 95],
      rsi: [45, 40],
      macdObj: { hist: [0, 1] },
      bb: { upper: [null, 120], lower: [null, 80], mid: [null, 100] },
      atr: [null, 5],
      volSeries: [1000, 1500]
    });

    const snapshot1h = buildSnapshotForReport({
      candles: candles1h,
      daily,
      ma20: [50, 54],
      ma50: [45, 53],
      ma100: [40, 52],
      ma200: [35, 50],
      rsi: [60, 65],
      macdObj: { hist: [0, 0.5] },
      bb: { upper: [null, 60], lower: [null, 40], mid: [null, 50] },
      atr: [null, 2],
      volSeries: [500, 600]
    });

    expect(snapshot4h.kpis.price).toBe(110);
    expect(snapshot4h.kpis.var24h).toBeCloseTo(0.1, 5);

    const summary = buildSummary({ assetKey: 'BTC', snapshots: { '4h': snapshot4h, '1h': snapshot1h } });
    expect(summary).toContain('**BTC**');
    expect(summary).toContain('110.0000');
    expect(summary).toContain('1h - 📈');
    expect(summary).toContain('24h 📈 10.00%');
    expect(summary).toContain('7d 📈 120.00%');
    expect(summary).toContain('5m - ??');
  });

  it('returns null for returns when daily data is missing', () => {
    const candles = [
      { o: 1, h: 2, l: 0.5, c: 1.5, v: 100 },
      { o: 1.5, h: 2.5, l: 1.0, c: 1.7, v: 120 }
    ];
    const daily = [
      { t: new Date('2023-01-03T00:00:00Z'), c: 1.7 }
    ];

    const snapshot = buildSnapshotForReport({
      candles,
      daily,
      ma20: [1, 1],
      ma50: [1, 1],
      ma100: [1, 1],
      ma200: [1, 1],
      rsi: [50, 50],
      macdObj: { hist: [0, 0] },
      bb: { upper: [null, 2], lower: [null, 1], mid: [null, 1.5] },
      atr: [null, 0.5],
      volSeries: [100, 120]
    });

    expect(snapshot.kpis.var24h).toBeNull();
    expect(snapshot.kpis.var7d).toBeNull();
    expect(snapshot.kpis.var30d).toBeNull();

    const summary = buildSummary({ assetKey: 'BTC', snapshots: { '4h': snapshot } });
    expect(summary).toContain('24h ??');
    expect(summary).toContain('7d ??');
    expect(summary).toContain('30d ??');
  });
});

