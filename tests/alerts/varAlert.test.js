import { describe, expect, it } from "vitest";
import varAlert, { __private__ } from "../../src/alerts/varAlert.js";
import { ALERT_LEVELS, ALERT_CATEGORIES } from "../../src/alerts/shared.js";

describe('varAlert', () => {
  it('aggregates multi-timeframe variation metrics with ordering', () => {
    const alerts = varAlert({
      timeframe: '1h',
      timeframeVariation: -0.0123,
      var24h: 0.0456,
      variationByTimeframe: { '4h': 0.02, '1h': -0.0123, '24h': 0.0456, '7d': 0.12 },
      timeframeOrder: ['4h', '1h', '30m', '15m', '5m']
    });

    expect(alerts).toEqual([
      {
        msg: '📊 Variações: 4h +2.00% • 1h -1.23% • 24h +4.56% • 7d +12.00%',
        level: ALERT_LEVELS.LOW,
        category: ALERT_CATEGORIES.VOLATILITY
      }
    ]);
  });

  it('falls back to timeframe and daily values when variation map is empty', () => {
    const alerts = varAlert({
      timeframe: '4h',
      timeframeVariation: 0.031,
      var24h: -0.015,
      variationByTimeframe: {},
      timeframeOrder: ['4h', '1h']
    });

    expect(alerts).toEqual([
      {
        msg: '📊 Variações: 4h +3.10% • 24h -1.50%',
        level: ALERT_LEVELS.LOW,
        category: ALERT_CATEGORIES.VOLATILITY
      }
    ]);
  });

  it('returns an empty array when no metrics are available', () => {
    const alerts = varAlert({
      timeframe: '1h',
      variationByTimeframe: null
    });

    expect(alerts).toEqual([]);
  });
});

describe('varAlert internals', () => {
  it('sorts labels respecting timeframe priority and fallback order', () => {
    const labels = __private__.sortLabels(['7d', '24h', '30m', '1h'], ['4h', '1h', '30m']);
    expect(labels).toEqual(['1h', '30m', '24h', '7d']);
  });
});
