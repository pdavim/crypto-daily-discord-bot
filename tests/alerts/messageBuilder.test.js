import { afterEach, describe, expect, it } from "vitest";
import { buildAssetAlertMessage, buildAssetGuidanceMessage, __private__ } from "../../src/alerts/messageBuilder.js";
import { ALERT_LEVELS, ALERT_CATEGORIES } from "../../src/alerts/shared.js";
import { CFG } from "../../src/config.js";


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

describe('buildAssetGuidanceMessage', () => {
  const originalEquity = CFG.accountEquity;
  const originalRisk = CFG.riskPerTrade;

  afterEach(() => {
    CFG.accountEquity = originalEquity;
    CFG.riskPerTrade = originalRisk;
  });

  it('creates sections with decision, guidance, variation and position size even without alerts', () => {
    CFG.accountEquity = 12500;
    CFG.riskPerTrade = 0.02;

    const message = buildAssetGuidanceMessage({
      assetKey: 'BTC',
      timeframeSummaries: [
        {
          timeframe: '4h',
          guidance: 'Comprar (📈)',
          decision: {
            decision: 'buy',
            emoji: '🟢',
            posture: 'bullish',
            confidence: 0.68,
            reasons: ['tendência de alta confirmada']
          },
          variation: 0.0185,
          forecast: {
            forecastClose: 106,
            lastClose: 105,
            delta: 1,
            confidence: 0.72,
            predictedAt: '2024-01-01T12:00:00Z'
          }
        },
        {
          timeframe: '1h',
          guidance: null,
          decision: null,
          variation: -0.004
        }
      ],
      variationByTimeframe: { '4h': 0.0185, '1h': -0.004 },
      timeframeOrder: ['4h', '1h']
    });

    expect(message).toContain('**🧭 Resumo — BTC**');
    expect(message).toContain('_Variações: 4h +1.85% • 1h -0.40%_');
    expect(message).toContain('> **4h** — Recomendação: Comprar (📈) — Variação: +1.85%');
    expect(message).toContain('↳ Decisão: 🟢 BUY');
    expect(message).toContain('↳ Posição estimada:');
    expect(message).toContain('(2.00% do capital)');
    expect(message).toContain('> **1h** — Recomendação: Sem recomendação — Variação: -0.40%');
    expect(message).toContain('↳ Decisão: dados insuficientes');
  });

  it('pede configuração quando não há dados de risco', () => {
    CFG.accountEquity = 0;
    CFG.riskPerTrade = 0;

    const message = buildAssetGuidanceMessage({
      assetKey: 'ETH',
      timeframeSummaries: [
        { timeframe: '4h', guidance: null, decision: null }
      ],
      variationByTimeframe: {}
    });

    expect(message).toContain('Posição estimada: defina accountEquity/riskPerTrade');
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
