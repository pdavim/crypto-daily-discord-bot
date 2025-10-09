import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const placeOrderMock = vi.fn();
const transferMarginMock = vi.fn();
const borrowMarginMock = vi.fn();
const repayMarginMock = vi.fn();
const reportTradingExecutionMock = vi.fn();
const reportTradingMarginMock = vi.fn();
const evaluateTradeIntentMock = vi.fn();

const getExchangeConnectorMock = vi.fn(() => ({
    id: 'binance',
    placeOrder: placeOrderMock,
    transferMargin: transferMarginMock,
    borrowMargin: borrowMarginMock,
    repayMargin: repayMarginMock,
}));

const resolveConnectorForAssetMock = vi.fn(() => ({
    id: 'binance',
    placeOrder: placeOrderMock,
    transferMargin: transferMarginMock,
    borrowMargin: borrowMarginMock,
    repayMargin: repayMarginMock,
}));

vi.mock("../../src/exchanges/index.js", () => ({
    getExchangeConnector: getExchangeConnectorMock,
    resolveConnectorForAsset: resolveConnectorForAssetMock,
}));

vi.mock("../../src/trading/notifier.js", () => ({
    reportTradingExecution: reportTradingExecutionMock,
    reportTradingMargin: reportTradingMarginMock,
}));

vi.mock("../../src/trading/riskManager.js", async () => {
    const actual = await vi.importActual("../../src/trading/riskManager.js");
    return {
        ...actual,
        evaluateTradeIntent: evaluateTradeIntentMock,
    };
});

const { CFG } = await import("../../src/config.js");
const { openPosition, closePosition, adjustMargin } = await import("../../src/trading/executor.js");
const { register } = await import("../../src/metrics.js");


describe("trading executor", () => {
    beforeEach(() => {
        placeOrderMock.mockReset();
        transferMarginMock.mockReset();
        borrowMarginMock.mockReset();
        repayMarginMock.mockReset();
        getExchangeConnectorMock.mockReset();
        resolveConnectorForAssetMock.mockReset();
        const connector = {
            id: 'binance',
            placeOrder: placeOrderMock,
            transferMargin: transferMarginMock,
            borrowMargin: borrowMarginMock,
            repayMargin: repayMarginMock,
        };
        getExchangeConnectorMock.mockReturnValue(connector);
        resolveConnectorForAssetMock.mockReturnValue(connector);
        reportTradingExecutionMock.mockReset();
        reportTradingMarginMock.mockReset();
        reportTradingExecutionMock.mockResolvedValue(undefined);
        reportTradingMarginMock.mockResolvedValue(undefined);
        register.resetMetrics();
        evaluateTradeIntentMock.mockReset();
        evaluateTradeIntentMock.mockImplementation((intent) => ({
            decision: "allow",
            quantity: intent.quantity,
            notional: intent.notional ?? null,
            compliance: { status: "cleared", breaches: [], messages: [] },
        }));

        CFG.trading = {
            enabled: true,
            minNotional: 20,
            maxPositionPct: 0.1,
            maxLeverage: 2,
            margin: {
                asset: "USDT",
                minFree: 50,
                transferAmount: 25,
            },
            strategy: {
                minimumConfidence: 0.35,
            },
        };
        CFG.accountEquity = 1000;
    });

    afterEach(() => {
        placeOrderMock.mockReset();
        transferMarginMock.mockReset();
        borrowMarginMock.mockReset();
        repayMarginMock.mockReset();
        reportTradingExecutionMock.mockReset();
        reportTradingMarginMock.mockReset();
        evaluateTradeIntentMock.mockReset();
        getExchangeConnectorMock.mockReset();
        resolveConnectorForAssetMock.mockReset();
    });

    it("skips trading when disabled", async () => {
        CFG.trading.enabled = false;
        const result = await openPosition({ symbol: "BTCUSDT", quantity: 0.1, price: 30000 });
        expect(result).toEqual({ executed: false, reason: 'disabled', details: {} });
        expect(placeOrderMock).not.toHaveBeenCalled();
        expect(reportTradingExecutionMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'skipped', reason: 'disabled' }));
        const metrics = await register.getMetricsAsJSON();
        const tradeMetric = metrics.find(m => m.name === 'app_trading_execution_total');
        const skipped = tradeMetric?.values.find(v => v.labels.action === 'openPosition' && v.labels.result === 'skipped');
        expect(skipped?.value).toBe(1);
    });

    it("rejects orders below minimum notional", async () => {
        const result = await openPosition({ symbol: "BTCUSDT", quantity: 0.0001, price: 100 });
        expect(result.reason).toBe("belowMinNotional");
        expect(placeOrderMock).not.toHaveBeenCalled();
        expect(reportTradingExecutionMock).toHaveBeenCalledWith(expect.objectContaining({ reason: 'belowMinNotional', status: 'skipped' }));
    });

    it("submits qualifying orders with safeguards", async () => {
        placeOrderMock.mockResolvedValueOnce({ orderId: 1, fillPrice: 30500 });
        const result = await openPosition({
            symbol: "BTCUSDT",
            direction: "long",
            quantity: 0.005,
            price: 30500,
        });
        expect(result.executed).toBe(true);
        expect(placeOrderMock).toHaveBeenCalledWith({
            symbol: "BTCUSDT",
            side: "BUY",
            type: "MARKET",
            quantity: 0.005,
            price: undefined,
            params: {},
        }, expect.any(Object));
        const metrics = await register.getMetricsAsJSON();
        const tradeMetric = metrics.find(m => m.name === 'app_trading_execution_total');
        const success = tradeMetric?.values.find(v => v.labels.action === 'openPosition' && v.labels.result === 'success');
        expect(success?.value).toBe(1);
        const notionalMetric = metrics.find(m => m.name === 'app_trading_notional_size');
        const sumEntry = notionalMetric?.values.find(v => v.metricName === 'app_trading_notional_size_sum');
        expect(sumEntry?.value).toBeCloseTo(0.005 * 30500, 6);
        expect(reportTradingExecutionMock).toHaveBeenCalledWith(expect.objectContaining({
            status: 'executed',
            action: 'open',
            metadata: expect.objectContaining({ compliance: expect.objectContaining({ status: 'cleared' }) }),
        }));
    });

    it("propagates submission failures", async () => {
        placeOrderMock.mockRejectedValueOnce(new Error("rejected"));
        await expect(openPosition({ symbol: "BTCUSDT", quantity: 0.005, price: 30000 })).rejects.toThrow("rejected");
        const metrics = await register.getMetricsAsJSON();
        const tradeMetric = metrics.find(m => m.name === 'app_trading_execution_total');
        const errors = tradeMetric?.values.find(v => v.labels.action === 'openPosition' && v.labels.result === 'error');
        expect(errors?.value).toBe(1);
        expect(reportTradingExecutionMock).toHaveBeenCalledWith(expect.objectContaining({
            status: 'error',
            action: 'open',
            metadata: expect.objectContaining({ compliance: expect.objectContaining({ status: 'cleared' }) }),
        }));
    });

    it("aborts orders when the risk manager blocks the trade", async () => {
        evaluateTradeIntentMock.mockImplementationOnce(() => ({
            decision: "block",
            reason: "maxExposure",
            quantity: 0.01,
            notional: 300,
            compliance: { status: "blocked", breaches: [{ type: "maxExposure" }] },
        }));

        const result = await openPosition({ symbol: "BTCUSDT", direction: "long", quantity: 0.01, price: 30000 });

        expect(result.executed).toBe(false);
        expect(result.reason).toBe('risk:maxExposure');
        expect(placeOrderMock).not.toHaveBeenCalled();
        expect(reportTradingExecutionMock).toHaveBeenCalledWith(expect.objectContaining({
            status: 'skipped',
            reason: 'risk:maxExposure',
            metadata: expect.objectContaining({ compliance: expect.objectContaining({ status: 'blocked' }) }),
        }));
    });

    it("scales quantity when the risk manager adjusts the trade", async () => {
        evaluateTradeIntentMock.mockImplementationOnce((intent) => ({
            decision: "scale",
            reason: "maxExposure",
            quantity: intent.quantity / 2,
            notional: intent.notional ? intent.notional / 2 : null,
            compliance: { status: "scaled", breaches: [{ type: "maxExposure" }] },
        }));
        placeOrderMock.mockResolvedValueOnce({ orderId: 10, fillPrice: 29500 });

        const result = await openPosition({ symbol: "BTCUSDT", direction: "long", quantity: 0.02, price: 29500 });

        expect(result.executed).toBe(true);
        expect(placeOrderMock).toHaveBeenCalledWith(expect.objectContaining({ quantity: 0.01 }), expect.any(Object));
        expect(reportTradingExecutionMock).toHaveBeenCalledWith(expect.objectContaining({
            status: 'executed',
            metadata: expect.objectContaining({ compliance: expect.objectContaining({ status: 'scaled' }) }),
        }));
    });

    it("closes positions using reduce only orders", async () => {
        placeOrderMock.mockResolvedValueOnce({ orderId: 2, fillPrice: 29800 });
        const result = await closePosition({ symbol: "BTCUSDT", direction: "long", quantity: 0.01, price: 29800 });
        expect(result.executed).toBe(true);
        expect(placeOrderMock).toHaveBeenCalledWith({
            symbol: "BTCUSDT",
            side: "SELL",
            type: "MARKET",
            quantity: 0.01,
            price: undefined,
            params: { reduceOnly: true },
        }, expect.any(Object));
        const metrics = await register.getMetricsAsJSON();
        const tradeMetric = metrics.find(m => m.name === 'app_trading_execution_total');
        const success = tradeMetric?.values.find(v => v.labels.action === 'closePosition' && v.labels.result === 'success');
        expect(success?.value).toBe(1);
        expect(reportTradingExecutionMock).toHaveBeenCalledWith(expect.objectContaining({
            status: 'executed',
            action: 'close',
            metadata: expect.objectContaining({ compliance: expect.objectContaining({ status: 'cleared' }) }),
        }));
    });

    it("avoids removing too much margin", async () => {
        CFG.trading.margin.minFree = 10;
        const result = await adjustMargin({ operation: "transferOut", amount: 50 });
        expect(result.adjusted).toBe(false);
        expect(result.reason).toBe("exceedsBuffer");
        expect(transferMarginMock).not.toHaveBeenCalled();
        expect(reportTradingMarginMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'skipped', reason: 'exceedsBuffer' }));
    });

    it("performs margin operations", async () => {
        transferMarginMock.mockResolvedValueOnce({ tranId: 1 });
        transferMarginMock.mockResolvedValueOnce({ tranId: 2 });
        borrowMarginMock.mockResolvedValueOnce({ tranId: 3 });
        repayMarginMock.mockResolvedValueOnce({ tranId: 4 });

        const transferIn = await adjustMargin({ operation: "transferIn", amount: 30 });
        const transferOut = await adjustMargin({ operation: "transferOut", amount: 5 });
        const borrow = await adjustMargin({ operation: "borrow", amount: 10 });
        const repay = await adjustMargin({ operation: "repay", amount: 10 });

        expect(transferIn.adjusted).toBe(true);
        expect(transferOut.adjusted).toBe(true);
        expect(borrow.adjusted).toBe(true);
        expect(repay.adjusted).toBe(true);
        const metrics = await register.getMetricsAsJSON();
        const tradeMetric = metrics.find(m => m.name === 'app_trading_execution_total');
        const marginSuccess = tradeMetric?.values.filter(v => v.labels.action === 'adjustMargin' && v.labels.result === 'success');
        const totalSuccess = marginSuccess?.reduce((sum, entry) => sum + entry.value, 0);
        expect(totalSuccess).toBe(4);
        expect(reportTradingMarginMock).toHaveBeenCalledTimes(4);
    });

    it("handles unsupported margin actions", async () => {
        const result = await adjustMargin({ operation: "unsupported" });
        expect(result.adjusted).toBe(false);
        expect(result.reason).toBe("unsupportedOperation");
        const metrics = await register.getMetricsAsJSON();
        const tradeMetric = metrics.find(m => m.name === 'app_trading_execution_total');
        const skipped = tradeMetric?.values.find(v => v.labels.action === 'adjustMargin' && v.labels.result === 'skipped');
        expect(skipped?.value).toBe(1);
        expect(reportTradingMarginMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'skipped', reason: 'unsupportedOperation' }));
    });
});
