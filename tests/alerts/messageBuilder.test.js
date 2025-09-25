import { describe, expect, it } from 'vitest';
import { buildAssetAlertMessage, __private__ } from '../../src/alerts/messageBuilder.js';
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
          decision: {
            decision: 'buy',
            emoji: '🟢',
            posture: 'bullish',
            confidence: 0.62,
            reasons: ['fast MA above slow MA threshold']
          },
          forecast: {
            forecastClose: 106,
            lastClose: 105,
            delta: 1,
            confidence: 0.72,
            predictedAt: '2024-01-01T12:00:00Z',
            timeZone: 'UTC',
            evaluation: {
              pctError: 0.02,
              directionHit: true
            }
          },
          alerts: [
            { msg: '📈 Breakout', level: ALERT_LEVELS.HIGH, category: ALERT_CATEGORIES.TREND, count: 2 }
          ]
        },
        {
          timeframe: '1h',
          guidance: 'Manter (🔁)',
          decision: {
            decision: 'hold',
            emoji: '🟡',
            posture: 'neutral',
            confidence: null,
            reasons: []
          },
          forecast: {
            forecastClose: 99,
            lastClose: 100,
            confidence: 0.35,
            predictedAt: '2024-01-01T13:00:00Z',
            timeZone: 'UTC'
          },
          alerts: [
            { msg: '⚠️ Pullback detectado', level: ALERT_LEVELS.MEDIUM, category: ALERT_CATEGORIES.INFO }
          ]
        }
      ],
      variationByTimeframe: { '4h': 0.0123, '1h': -0.01, '24h': 0.05 },
      timeframeOrder: ['4h', '1h']
    });

    expect(message).toContain('**⚠️ Alertas — BTC** @here');
    expect(message).toContain('_Variações: 4h +1.23% • 1h -1.00% • 24h +5.00%_');
    expect(message).toContain('> **4h** — Recomendação: Comprar (📈) — Variação: +1.23%');
    expect(message).toContain('> **1h** — Recomendação: Manter (🔁) — Variação: -1.00%');
    expect(message).toContain('↳ Previsão: 🔮 106.00 — Δ +1.00 (0.95%) — confiança 72% — alvo 01/01, 12:00 — histórico erro 2.00% | direção ✅');
    expect(message).toContain('↳ Previsão: 🔮 99.00 — Δ -1.00 (-1.00%) — confiança 35% — alvo 01/01, 13:00');
    expect(message).toContain('• 🔴 **ALTA:** _Tendência_ — 📈 Breakout x2');
    expect(message).toContain('↳ Decisão: 🟢 BUY — postura tendência de alta — confiança 62% — motivos: fast MA above slow MA threshold');
    expect(message).toContain('↳ Decisão: 🟡 HOLD — postura neutra');
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

describe('formatForecastLine', () => {
  const { formatForecastLine } = __private__;

  it('formats forecast details with fallback delta and evaluation', () => {
    const line = formatForecastLine({
      forecastClose: 20500.123,
      lastClose: 20000,
      confidence: 0.66,
      predictedAt: '2024-02-02T15:30:00Z',
      timeZone: 'Europe/Lisbon',
      evaluation: {
        pctError: 0.031,
        directionHit: false
      }
    });

    expect(line).toContain('🔮 20500.12');
    expect(line).toContain('Δ +500.12 (2.50%)');
    expect(line).toContain('confiança 66%');
    expect(line).toMatch(/alvo \d{2}\/\d{2}, \d{2}:\d{2}/);
    expect(line).toContain('histórico erro 3.10% | direção ❌');
  });
});
