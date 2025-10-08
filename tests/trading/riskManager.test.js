import { beforeEach, describe, expect, it } from "vitest";

const { CFG } = await import("../../src/config.js");
const { evaluateTradeIntent } = await import("../../src/trading/riskManager.js");

describe("risk manager evaluation", () => {
    beforeEach(() => {
        CFG.accountEquity = 10000;
        CFG.trading = {
            riskPolicy: {
                maxExposurePct: 0.2,
                maxExposureValue: null,
                maxDailyLossPct: 0.05,
                maxDailyLossValue: null,
                volatilityTriggers: { enabled: false },
                blacklist: { symbols: [], reasons: {} },
            },
        };
    });

    it("blocks trades on blacklisted symbols", () => {
        CFG.trading.riskPolicy.blacklist = {
            symbols: ["BTCUSDT"],
            reasons: { BTCUSDT: "Sanctioned" },
        };

        const result = evaluateTradeIntent({
            action: "open",
            symbol: "BTCUSDT",
            quantity: 0.1,
            price: 20000,
        }, { accountEquity: CFG.accountEquity });

        expect(result.decision).toBe("block");
        expect(result.reason).toBe("blacklist");
        expect(result.compliance.status).toBe("blocked");
        expect(result.compliance.breaches[0]).toMatchObject({ type: "blacklist" });
    });

    it("scales trades when exposure exceeds the limit", () => {
        CFG.trading.riskPolicy.maxExposurePct = 0.1;

        const result = evaluateTradeIntent({
            action: "open",
            symbol: "ETHUSDT",
            quantity: 0.2,
            price: 2000,
        }, {
            accountEquity: CFG.accountEquity,
            totalExposure: 900,
        });

        expect(result.decision).toBe("scale");
        expect(result.quantity).toBeGreaterThan(0);
        expect(result.quantity).toBeLessThan(0.2);
        expect(result.compliance.status).toBe("scaled");
    });

    it("blocks trades once the daily loss limit is reached", () => {
        CFG.trading.riskPolicy.maxDailyLossPct = 0.02;

        const result = evaluateTradeIntent({
            action: "open",
            symbol: "SOLUSDT",
            quantity: 10,
            price: 100,
        }, {
            accountEquity: 5000,
            dailyLoss: 200,
        });

        expect(result.decision).toBe("block");
        expect(result.reason).toBe("dailyLoss");
        expect(result.compliance.status).toBe("blocked");
        expect(result.compliance.breaches[0]).toMatchObject({ type: "dailyLoss" });
    });
});
