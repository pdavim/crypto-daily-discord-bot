import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const reportTradingExecutionMock = vi.fn();
const reportTradingMarginMock = vi.fn();
const evaluateTradeIntentMock = vi.fn((intent) => ({
    decision: "allow",
    quantity: intent.quantity,
    notional: intent.notional ?? intent.quantity ?? null,
    compliance: { status: "cleared", breaches: [], messages: [] },
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

const {
    registerExchangeConnector,
    unregisterExchangeConnector,
    getExchangeConnector,
    resolveConnectorForAsset,
} = await import("../../src/exchanges/index.js");
const { CFG } = await import("../../src/config.js");
const { fetchOHLCV } = await import("../../src/data/marketData.js");
const { openPosition } = await import("../../src/trading/executor.js");

const buildConnector = ({ id, fetchCandles, fetchDailyCloses, placeOrder }) => ({
    id,
    metadata: { name: id.toUpperCase() },
    fetchCandles,
    fetchDailyCloses,
    placeOrder,
    getBalances: vi.fn(async () => []),
});

const binanceCandlesMock = vi.fn();
const binanceDailyMock = vi.fn();
const binancePlaceOrderMock = vi.fn(async () => ({ orderId: "bin-1", fillPrice: 25_000 }));

const paperCandlesMock = vi.fn();
const paperDailyMock = vi.fn();
const paperPlaceOrderMock = vi.fn(async () => ({ orderId: "paper-1", fillPrice: 12 }));

let originalBinance;
let originalAssets;
let originalAssetMap;

beforeAll(() => {
    originalBinance = getExchangeConnector("binance");
});

beforeEach(() => {
    binanceCandlesMock.mockReset();
    binanceDailyMock.mockReset();
    binancePlaceOrderMock.mockReset();
    paperCandlesMock.mockReset();
    paperDailyMock.mockReset();
    paperPlaceOrderMock.mockReset();
    reportTradingExecutionMock.mockReset();
    reportTradingMarginMock.mockReset();
    evaluateTradeIntentMock.mockClear();

    registerExchangeConnector(buildConnector({
        id: "binance",
        fetchCandles: binanceCandlesMock,
        fetchDailyCloses: binanceDailyMock,
        placeOrder: binancePlaceOrderMock,
    }), { replace: true });

    registerExchangeConnector(buildConnector({
        id: "paper",
        fetchCandles: paperCandlesMock,
        fetchDailyCloses: paperDailyMock,
        placeOrder: paperPlaceOrderMock,
    }), { replace: true });

    originalAssets = CFG.assets;
    originalAssetMap = CFG.assetMap;
    const assets = [
        {
            key: "BTC",
            exchange: "binance",
            symbol: "BTCUSDT",
            symbols: { market: "BTCUSDT" },
            capabilities: { candles: true, daily: true, trading: true },
        },
        {
            key: "PAPER",
            exchange: "paper",
            symbol: "PAPERUSD",
            symbols: { market: "PAPERUSD" },
            capabilities: { candles: true, daily: true, trading: true },
        },
    ];
    CFG.assets = assets;
    CFG.assetMap = new Map(assets.map(asset => [asset.key, asset]));
    CFG.trading = {
        enabled: true,
        minNotional: 0,
        maxPositionPct: 1,
        maxLeverage: 1,
    };
    CFG.accountEquity = 10_000;
});

afterEach(() => {
    if (originalBinance) {
        registerExchangeConnector(originalBinance, { replace: true });
    }
    unregisterExchangeConnector("paper");
    CFG.assets = originalAssets;
    CFG.assetMap = originalAssetMap;
});

describe("exchange connector registry", () => {
    it("resolves connectors based on asset configuration", () => {
        const btcAsset = CFG.assetMap.get("BTC");
        const paperAsset = CFG.assetMap.get("PAPER");
        expect(resolveConnectorForAsset(btcAsset)?.id).toBe("binance");
        expect(resolveConnectorForAsset(paperAsset)?.id).toBe("paper");
    });

    it("routes market data requests to the appropriate connector", async () => {
        binanceCandlesMock.mockResolvedValue([{ t: 1 }]);
        paperCandlesMock.mockResolvedValue([{ t: 2 }]);

        const btcCandles = await fetchOHLCV("BTC", "1h");
        const paperCandles = await fetchOHLCV("PAPER", "1h");

        expect(binanceCandlesMock).toHaveBeenCalledWith({ symbol: "BTCUSDT", interval: "1h", limit: undefined });
        expect(paperCandlesMock).toHaveBeenCalledWith({ symbol: "PAPERUSD", interval: "1h", limit: undefined });
        expect(btcCandles).toEqual([{ t: 1 }]);
        expect(paperCandles).toEqual([{ t: 2 }]);
    });

    it("executes trades using the asset's connector", async () => {
        paperPlaceOrderMock.mockResolvedValueOnce({ orderId: "paper-42", fillPrice: 15 });
        const result = await openPosition({ symbol: "PAPERUSD", quantity: 1, price: 15, type: "MARKET" });

        expect(result.executed).toBe(true);
        expect(paperPlaceOrderMock).toHaveBeenCalledTimes(1);
        expect(binancePlaceOrderMock).not.toHaveBeenCalled();
        expect(reportTradingExecutionMock).toHaveBeenCalledWith(expect.objectContaining({
            action: "open",
            status: "executed",
            symbol: "PAPERUSD",
        }));
    });
});
