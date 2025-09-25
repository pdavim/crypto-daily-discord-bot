import { describe, expect, it } from 'vitest';
import { deriveDecisionDetails, formatDecisionLine, DECISION_LABELS } from '../../src/alerts/decision.js';

describe('deriveDecisionDetails', () => {
  it('derives buy decision from long strategy with posture context', () => {
    const details = deriveDecisionDetails({
      strategy: {
        action: 'long',
        posture: 'bullish',
        confidence: 0.58,
        reasons: ['fast MA above slow MA threshold', 'trend strength confirmed']
      },
      posture: {
        posture: 'bullish',
        confidence: 0.6,
        reasons: ['fallback reason should be ignored']
      }
    });

    expect(details.decision).toBe(DECISION_LABELS.BUY);
    expect(details.emoji).toBe('🟢');
    expect(details.posture).toBe('bullish');
    expect(details.confidence).toBe(0.58);
    expect(details.reasons).toEqual(['fast MA above slow MA threshold', 'trend strength confirmed']);
  });

  it('falls back to hold when strategy action missing', () => {
    const details = deriveDecisionDetails({
      strategy: {
        action: null,
        confidence: 'not-a-number'
      },
      posture: {
        posture: 'neutral',
        reasons: ['neutral trend'],
        confidence: 0.25
      }
    });

    expect(details.decision).toBe(DECISION_LABELS.HOLD);
    expect(details.emoji).toBe('🟡');
    expect(details.posture).toBe('neutral');
    expect(details.confidence).toBe(0.25);
    expect(details.reasons).toEqual(['neutral trend']);
  });
});

describe('formatDecisionLine', () => {
  it('formats decision details into a readable summary', () => {
    const summary = formatDecisionLine({
      decision: DECISION_LABELS.BUY,
      emoji: '🟢',
      posture: 'bullish',
      confidence: 0.61,
      reasons: ['fast MA above slow MA threshold']
    });

    expect(summary).toBe('🟢 BUY — postura tendência de alta — confiança 61% — motivos: fast MA above slow MA threshold');
  });

  it('returns null when details are missing', () => {
    expect(formatDecisionLine(null)).toBeNull();
    expect(formatDecisionLine({})).toBeNull();
  });
});
