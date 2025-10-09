import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchCandlesMock = vi.fn();
const fetchDailyClosesMock = vi.fn();

const resolveConnectorForAssetMock = vi.fn();

vi.mock("../../src/exchanges/index.js", () => ({
    resolveConnectorForAsset: resolveConnectorForAssetMock,
}));

const { CFG } = await import("../../src/config.js");
const { fetchOHLCV, fetchDailyCloses } = await import("../../src/data/marketData.js");

const buildAsset = (overrides = {}) => ({
    key: "BTC",
    exchange: "binance",
    symbol: "BTCUSDT",
    symbols: { market: "BTCUSDT", spot: "BTCUSDT" },
    capabilities: { candles: true, daily: true },
    ...overrides,
});

describe("market data facade", () => {
    beforeEach(() => {
        fetchCandlesMock.mockReset();
        fetchDailyClosesMock.mockReset();
        resolveConnectorForAssetMock.mockReset();
        const asset = buildAsset();
        CFG.assets = [asset];
        CFG.assetMap = new Map([[asset.key, asset]]);
        resolveConnectorForAssetMock.mockImplementation((assetOrKey) => {
            const resolved = typeof assetOrKey === "string"
                ? CFG.assetMap.get(assetOrKey.toUpperCase())
                : assetOrKey;
            if (!resolved) {
                return null;
            }
            return {
                id: resolved.exchange,
                fetchCandles: fetchCandlesMock,
                fetchDailyCloses: fetchDailyClosesMock,
            };
        });
    });

    it("passes normalized asset metadata to the connector", async () => {
        fetchCandlesMock.mockResolvedValue([{ t: 1 }]);
        const candles = await fetchOHLCV("BTC", "1h", { limit: 10 });
        expect(candles).toEqual([{ t: 1 }]);
        expect(fetchCandlesMock).toHaveBeenCalledWith({ symbol: "BTCUSDT", interval: "1h", limit: 10 });
    });

    it("supports passing the asset object directly", async () => {
        const asset = buildAsset({ key: "ETH", symbol: "ETHUSDT", symbols: { market: "ETHUSDT" } });
        CFG.assets.push(asset);
        CFG.assetMap.set(asset.key, asset);
        fetchDailyClosesMock.mockResolvedValue([{ t: 1 }]);
        const result = await fetchDailyCloses(asset, 5);
        expect(result).toEqual([{ t: 1 }]);
        expect(fetchDailyClosesMock).toHaveBeenCalledWith({ symbol: "ETHUSDT", days: 5 });
    });

    it("throws when no connector can be resolved", async () => {
        resolveConnectorForAssetMock.mockReturnValueOnce(null);
        await expect(fetchOHLCV("BTC", "1h")).rejects.toThrow(/No connector registered/);
    });

    it("throws when the asset lacks a symbol", async () => {
        const asset = buildAsset({ key: "ALT", symbol: "", symbols: {} });
        CFG.assets = [asset];
        CFG.assetMap = new Map([[asset.key, asset]]);
        await expect(fetchOHLCV("ALT", "1h")).rejects.toThrow(/Missing symbol/);
    });
});
