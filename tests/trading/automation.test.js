import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getMarginPositionRiskMock = vi.fn();
const openPositionMock = vi.fn();
const closePositionMock = vi.fn();

vi.mock("../../src/trading/binance.js", () => ({
    getMarginPositionRisk: getMarginPositionRiskMock,
}));

vi.mock("../../src/trading/executor.js", () => ({
    openPosition: openPositionMock,
    closePosition: closePositionMock,
}));

const loggerMocks = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

const reportTradingDecisionMock = vi.fn();

vi.mock("../../src/logger.js", () => ({
    logger: loggerMocks,
    withContext: () => loggerMocks,
}));

vi.mock("../../src/trading/notifier.js", () => ({
    reportTradingDecision: reportTradingDecisionMock,
}));

const { CFG } = await import("../../src/config.js");
const { automateTrading } = await import("../../src/trading/automation.js");

describe("automated trading integration", () => {
    beforeEach(() => {
        getMarginPositionRiskMock.mockReset();
        openPositionMock.mockReset();
        closePositionMock.mockReset();
        Object.values(loggerMocks).forEach(mock => mock.mockReset());
        reportTradingDecisionMock.mockReset();
        CFG.trading = {
            enabled: true,
            automation: {
                enabled: true,
                timeframe: "4h",
                minConfidence: 0.55,
                positionPct: 0.05,
                maxPositions: 3,
                positionEpsilon: 0.0001,
            },
        };
        CFG.accountEquity = 1000;
    });

    afterEach(() => {
        getMarginPositionRiskMock.mockReset();
        openPositionMock.mockReset();
        closePositionMock.mockReset();
        Object.values(loggerMocks).forEach(mock => mock.mockReset());
        reportTradingDecisionMock.mockReset();
    });

    it("skips when trading or automation are disabled", async () => {
        CFG.trading.enabled = false;
        const result = await automateTrading({
            assetKey: "BTC",
            symbol: "BTCUSDT",
            timeframe: "4h",
            decision: { decision: "buy", confidence: 0.9 },
            posture: { confidence: 0.9 },
            strategy: { confidence: 0.9 },
            snapshot: { kpis: { price: 30000 } },
        });
        expect(result).toEqual({ skipped: true, reason: "disabled" });
        expect(getMarginPositionRiskMock).not.toHaveBeenCalled();
        expect(reportTradingDecisionMock).toHaveBeenCalledWith(expect.objectContaining({ status: "skipped", reason: "disabled" }));
    });

    it("opens a long position when confidence is sufficient", async () => {
        getMarginPositionRiskMock.mockResolvedValueOnce([]);
        const result = await automateTrading({
            assetKey: "BTC",
            symbol: "BTCUSDT",
            timeframe: "4h",
            decision: { decision: "buy", confidence: 0.8 },
            posture: { confidence: 0.8 },
            strategy: { confidence: 0.8 },
            snapshot: { kpis: { price: 30000 } },
        });
        expect(result.executed).toBe(true);
        expect(result.direction).toBe("long");
        expect(openPositionMock).toHaveBeenCalledTimes(1);
        const call = openPositionMock.mock.calls[0][0];
        expect(call.direction).toBe("long");
        expect(call.quantity).toBeCloseTo((CFG.accountEquity * CFG.trading.automation.positionPct) / 30000, 6);
        expect(closePositionMock).not.toHaveBeenCalled();
        expect(reportTradingDecisionMock).toHaveBeenCalledWith(expect.objectContaining({ status: "executed", action: "open" }));
    });

    it("closes an open position when signal turns flat", async () => {
        getMarginPositionRiskMock.mockResolvedValueOnce([{ symbol: "BTCUSDT", positionAmt: "0.02" }]);
        const result = await automateTrading({
            assetKey: "BTC",
            symbol: "BTCUSDT",
            timeframe: "4h",
            decision: { decision: "hold", confidence: 0.7 },
            posture: { confidence: 0.7 },
            strategy: { confidence: 0.7 },
            snapshot: { kpis: { price: 31000 } },
        });
        expect(result.executed).toBe(true);
        expect(result.action).toBe("close");
        expect(closePositionMock).toHaveBeenCalledTimes(1);
        const call = closePositionMock.mock.calls[0][0];
        expect(call.direction).toBe("long");
        expect(call.quantity).toBeCloseTo(0.02);
        expect(reportTradingDecisionMock).toHaveBeenCalledWith(expect.objectContaining({ action: "close", status: "executed" }));
    });

    it("reverses short positions before opening a long", async () => {
        getMarginPositionRiskMock.mockResolvedValueOnce([{ symbol: "BTCUSDT", positionAmt: "-0.01" }]);
        const result = await automateTrading({
            assetKey: "BTC",
            symbol: "BTCUSDT",
            timeframe: "4h",
            decision: { decision: "buy", confidence: 0.9 },
            posture: { confidence: 0.9 },
            strategy: { confidence: 0.9 },
            snapshot: { kpis: { price: 28000 } },
        });
        expect(result.executed).toBe(true);
        expect(closePositionMock).toHaveBeenCalledTimes(1);
        expect(openPositionMock).toHaveBeenCalledTimes(1);
        expect(closePositionMock.mock.calls[0][0].direction).toBe("short");
        expect(openPositionMock.mock.calls[0][0].direction).toBe("long");
        expect(reportTradingDecisionMock).toHaveBeenCalledWith(expect.objectContaining({ action: "close", status: "executed" }));
        expect(reportTradingDecisionMock).toHaveBeenCalledWith(expect.objectContaining({ action: "open", status: "executed" }));
    });

    it("respects maximum active position limits", async () => {
        CFG.trading.automation.maxPositions = 1;
        getMarginPositionRiskMock.mockResolvedValueOnce([
            { symbol: "ETHUSDT", positionAmt: "0.05" },
        ]);
        const result = await automateTrading({
            assetKey: "BTC",
            symbol: "BTCUSDT",
            timeframe: "4h",
            decision: { decision: "buy", confidence: 0.8 },
            posture: { confidence: 0.8 },
            strategy: { confidence: 0.8 },
            snapshot: { kpis: { price: 29000 } },
        });
        expect(result).toEqual({ skipped: true, reason: "maxPositions" });
        expect(openPositionMock).not.toHaveBeenCalled();
        expect(reportTradingDecisionMock).toHaveBeenCalledWith(expect.objectContaining({ reason: "maxPositions", status: "skipped" }));
    });

    it("skips trades when confidence is below the threshold", async () => {
        getMarginPositionRiskMock.mockResolvedValueOnce([]);
        const result = await automateTrading({
            assetKey: "BTC",
            symbol: "BTCUSDT",
            timeframe: "4h",
            decision: { decision: "buy", confidence: 0.3 },
            posture: { confidence: 0.3 },
            strategy: { confidence: 0.3 },
            snapshot: { kpis: { price: 27000 } },
        });
        expect(result.reason).toBe("lowConfidence");
        expect(openPositionMock).not.toHaveBeenCalled();
        expect(reportTradingDecisionMock).toHaveBeenCalledWith(expect.objectContaining({ reason: "lowConfidence", status: "skipped" }));
    });
});
