import { describe, expect, it } from "vitest";
import { collectVariationMetrics, __private__ } from "../../src/alerts/variationMetrics.js";

describe('collectVariationMetrics', () => {
  it('builds a consolidated variation map across timeframes and horizons', () => {
    const snapshots = {
      '4h': { kpis: { var: 0.0123, var24h: 0.045, var7d: 0.1, var30d: -0.05 } },
      '1h': { kpis: { var: -0.008 } },
      '30m': { kpis: { var: 0.003 } }
    };

    const metrics = collectVariationMetrics({ snapshots });

    expect(metrics).toEqual({
      '4h': 0.0123,
      '1h': -0.008,
      '30m': 0.003,
      '24h': 0.045,
      '7d': 0.1,
      '30d': -0.05
    });
  });

  it('skips non-finite and missing values', () => {
    const snapshots = {
      '4h': { kpis: { var: null, var24h: Number.NaN } },
      '1h': { kpis: { var: undefined } }
    };

    const metrics = collectVariationMetrics({ snapshots });
    expect(metrics).toEqual({});
  });

  it('prefers 4h snapshot as anchor for higher timeframe metrics', () => {
    const anchor = { kpis: { var24h: 0.02, var7d: 0.05, var30d: 0.1 } };
    const metrics = collectVariationMetrics({ snapshots: { '1h': anchor, '15m': { kpis: { var: 0.01 } } } });
    expect(metrics).toMatchObject({ '24h': 0.02, '7d': 0.05, '30d': 0.1 });
  });
});

describe('variationMetrics internals', () => {
  it('identifies anchor snapshot following priority order', () => {
    const anchor = { kpis: { var24h: 0.1 } };
    const result = __private__.resolveAnchorSnapshot({ '15m': {}, '4h': anchor, '1h': {} });
    expect(result).toBe(anchor);
  });
});
