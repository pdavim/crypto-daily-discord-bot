import { describe, expect, it } from 'vitest';
import { buildAssetAlertMessage } from '../../src/alerts/messageBuilder.js';
import { ALERT_LEVELS, ALERT_CATEGORIES } from '../../src/alerts/shared.js';

describe('buildAssetAlertMessage', () => {
  it('includes variation overview and guidance for each timeframe', () => {
    const message = buildAssetAlertMessage({
      assetKey: 'BTC',
      mention: '@here',
      timeframeSummaries: [
        {
          timeframe: '4h',
          guidance: 'Comprar (📈)',
          alerts: [
            { msg: '📈 Breakout', level: ALERT_LEVELS.HIGH, category: ALERT_CATEGORIES.TREND, count: 2 }
          ]
        },
        {
          timeframe: '1h',
          guidance: 'Manter (🔁)',
          alerts: [
            { msg: '⚠️ Pullback detectado', level: ALERT_LEVELS.MEDIUM, category: ALERT_CATEGORIES.INFO }
          ]
        }
      ],
      variationByTimeframe: { '4h': 0.0123, '1h': -0.01 },
      timeframeOrder: ['4h', '1h']
    });

    expect(message).toContain('**⚠️ Alertas — BTC** @here');
    expect(message).toContain('_Variações: 4h +1.23% • 1h -1.00%_');
    expect(message).toContain('> **4h** — Recomendação: Comprar (📈) — Variação: +1.23%');
    expect(message).toContain('> **1h** — Recomendação: Manter (🔁) — Variação: -1.00%');
    expect(message).toContain('• 🔴 **ALTA:** _Tendência_ — 📈 Breakout x2');
  });

  it('returns null when summaries have no alerts', () => {
    const message = buildAssetAlertMessage({
      assetKey: 'ETH',
      mention: '@here',
      timeframeSummaries: [],
      variationByTimeframe: {}
    });

    expect(message).toBeNull();
  });
});
