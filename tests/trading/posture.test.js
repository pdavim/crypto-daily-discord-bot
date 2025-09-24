import { beforeEach, describe, expect, it } from "vitest";

const { CFG } = await import("../../src/config.js");
const { evaluateMarketPosture, deriveStrategyFromPosture, computeSlopePercent } = await import("../../src/trading/posture.js");

describe("market posture evaluation", () => {
    beforeEach(() => {
        CFG.marketPosture = {
            bullishMaRatio: 1.01,
            bearishMaRatio: 0.99,
            neutralBuffer: 0.003,
            minSlope: 0.0005,
            lookback: 4,
            minTrendStrength: 18,
            rsiBullish: 55,
            rsiBearish: 45,
        };
        CFG.trading = {
            strategy: {
                minimumConfidence: 0.35,
            },
        };
    });

    it("flags bullish posture with confident strategy", () => {
        const closes = [100, 102, 104, 107, 110];
        const maFast = [null, 101, 103, 105, 108];
        const maSlow = [null, 99, 100, 101, 102];
        const rsi = [40, 45, 55, 60, 65];
        const adx = [12, 15, 18, 25, 28];

        const posture = evaluateMarketPosture({
            closes,
            maFastSeries: maFast,
            maSlowSeries: maSlow,
            rsiSeries: rsi,
            adxSeries: adx,
        });
        expect(posture.posture).toBe("bullish");
        expect(posture.confidence).toBeGreaterThan(0.5);

        const strategy = deriveStrategyFromPosture(posture, { minimumConfidence: 0.4 });
        expect(strategy.action).toBe("long");
    });

    it("flags bearish posture when momentum turns", () => {
        const closes = [120, 118, 115, 112, 108];
        const maFast = [null, 119, 117, 114, 110];
        const maSlow = [null, 121, 120, 119, 118];
        const rsi = [55, 50, 42, 38, 35];
        const adx = [15, 18, 22, 24, 26];

        const posture = evaluateMarketPosture({
            closes,
            maFastSeries: maFast,
            maSlowSeries: maSlow,
            rsiSeries: rsi,
            adxSeries: adx,
        });
        expect(posture.posture).toBe("bearish");

        const strategy = deriveStrategyFromPosture(posture);
        expect(strategy.action).toBe("short");
    });

    it("keeps flat posture when confidence too low", () => {
        CFG.trading.strategy.minimumConfidence = 0.6;
        const closes = [50, 50.2, 50.1, 50.3, 50.25];
        const maFast = [null, 50.1, 50.15, 50.2, 50.22];
        const maSlow = [null, 50.05, 50.1, 50.15, 50.18];
        const rsi = [49, 50, 51, 52, 50];
        const adx = [8, 10, 11, 12, 13];

        const posture = evaluateMarketPosture({
            closes,
            maFastSeries: maFast,
            maSlowSeries: maSlow,
            rsiSeries: rsi,
            adxSeries: adx,
        });
        const strategy = deriveStrategyFromPosture(posture);
        expect(strategy.action).toBe("flat");
        expect(strategy.reasons[strategy.reasons.length - 1]).toContain("confidence");
    });

    it("computes slope percentages", () => {
        const slope = computeSlopePercent([100, 101, 102, 103, 104], 4);
        expect(slope).toBeCloseTo(0.04);
    });
});
