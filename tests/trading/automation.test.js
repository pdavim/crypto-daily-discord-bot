import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getMarginPositionRiskMock = vi.fn();
const openPositionMock = vi.fn();
const closePositionMock = vi.fn();
const evaluateTradeIntentMock = vi.fn();

const getExchangeConnectorMock = vi.fn(() => ({
    id: 'binance',
    getMarginPositionRisk: getMarginPositionRiskMock,
}));

vi.mock("../../src/exchanges/index.js", () => ({
    getExchangeConnector: getExchangeConnectorMock,
}));

vi.mock("../../src/trading/executor.js", () => ({
    openPosition: openPositionMock,
    closePosition: closePositionMock,
}));

vi.mock("../../src/trading/riskManager.js", async () => {
    const actual = await vi.importActual("../../src/trading/riskManager.js");
    return {
        ...actual,
        evaluateTradeIntent: evaluateTradeIntentMock,
    };
});

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
        evaluateTradeIntentMock.mockReset();
        getExchangeConnectorMock.mockReset();
        getExchangeConnectorMock.mockReturnValue({ id: 'binance', getMarginPositionRisk: getMarginPositionRiskMock });
        evaluateTradeIntentMock.mockImplementation((intent) => ({
            decision: "allow",
            quantity: intent.quantity,
            notional: intent.notional ?? null,
            compliance: { status: "cleared", breaches: [], messages: [] },
        }));
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
        evaluateTradeIntentMock.mockReset();
        getExchangeConnectorMock.mockReset();
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
        expect(call.metadata.compliance).toMatchObject({ status: "cleared" });
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
        expect(call.metadata.compliance).toMatchObject({ status: "cleared" });
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
        expect(openPositionMock.mock.calls[0][0].metadata.compliance).toMatchObject({ status: "cleared" });
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

    it("blocks trades when the risk manager rejects the order", async () => {
        getMarginPositionRiskMock.mockResolvedValueOnce([]);
        evaluateTradeIntentMock.mockImplementationOnce(() => ({
            decision: "block",
            reason: "maxExposure",
            quantity: 1,
            notional: 1000,
            compliance: {
                status: "blocked",
                breaches: [{ type: "maxExposure" }],
                messages: ["Exposure limit"],
            },
        }));

        const result = await automateTrading({
            assetKey: "BTC",
            symbol: "BTCUSDT",
            timeframe: "4h",
            decision: { decision: "buy", confidence: 0.8 },
            posture: { confidence: 0.8 },
            strategy: { confidence: 0.8 },
            snapshot: { kpis: { price: 29000 } },
        });

        expect(result.skipped).toBe(true);
        expect(result.reason).toBe("risk");
        expect(openPositionMock).not.toHaveBeenCalled();
        expect(reportTradingDecisionMock).toHaveBeenCalledWith(expect.objectContaining({
            reason: "risk:maxExposure",
            metadata: expect.objectContaining({ compliance: expect.objectContaining({ status: "blocked" }) }),
        }));
    });

    it("scales trades when the risk manager reduces exposure", async () => {
        getMarginPositionRiskMock.mockResolvedValueOnce([]);
        evaluateTradeIntentMock.mockImplementationOnce((intent) => ({
            decision: "scale",
            reason: "maxExposure",
            quantity: intent.quantity / 2,
            notional: intent.notional ? intent.notional / 2 : null,
            compliance: {
                status: "scaled",
                breaches: [{ type: "maxExposure" }],
                messages: ["Scaled by risk"],
            },
        }));

        const result = await automateTrading({
            assetKey: "BTC",
            symbol: "BTCUSDT",
            timeframe: "4h",
            decision: { decision: "buy", confidence: 0.9 },
            posture: { confidence: 0.9 },
            strategy: { confidence: 0.9 },
            snapshot: { kpis: { price: 31000 } },
        });

        expect(result.executed).toBe(true);
        expect(openPositionMock).toHaveBeenCalledTimes(1);
        const call = openPositionMock.mock.calls[0][0];
        expect(call.quantity).toBeCloseTo(((CFG.accountEquity * CFG.trading.automation.positionPct) / 31000) / 2, 6);
        expect(call.metadata.compliance).toMatchObject({ status: "scaled" });
        expect(reportTradingDecisionMock).toHaveBeenCalledWith(expect.objectContaining({
            status: "executed",
            metadata: expect.objectContaining({ compliance: expect.objectContaining({ status: "scaled" }) }),
        }));
    });
});
