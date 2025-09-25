import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("axios", () => {
    const mock = vi.fn();
    return { default: mock };
});

const logTradeMock = vi.fn();

const loggerMock = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
};
loggerMock.child = vi.fn(() => loggerMock);
const withContextMock = vi.fn(() => loggerMock);

vi.mock("../../src/logger.js", () => ({
    __esModule: true,
    logger: loggerMock,
    default: loggerMock,
    withContext: withContextMock,
}));

vi.mock("../../src/trading/tradeLog.js", () => ({
    logTrade: logTradeMock,
}));

const originalEnv = { ...process.env };
const axios = (await import("axios")).default;

function fixedSignature(params, secret) {
    const query = new URLSearchParams(params).toString();
    return crypto.createHmac("sha256", secret).update(query).digest("hex");
}

describe("Binance trading integration", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
        process.env = { ...originalEnv, BINANCE_API_KEY: "test-key", BINANCE_SECRET: "test-secret" };
        axios.mockReset();
        logTradeMock.mockReset();
        withContextMock.mockClear();
        loggerMock.info.mockClear();
        loggerMock.debug.mockClear();
        loggerMock.warn.mockClear();
        loggerMock.error.mockClear();
        loggerMock.child.mockClear();
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        vi.useRealTimers();
    });

    it("throws when credentials are missing", async () => {
        process.env = { ...originalEnv, BINANCE_API_KEY: "", BINANCE_SECRET: "" };
        const { getSpotBalances } = await import("../../src/trading/binance.js");
        await expect(getSpotBalances()).rejects.toThrow("Missing Binance API credentials");
    });

    it("fetches and normalizes spot balances", async () => {
        axios.mockResolvedValueOnce({
            data: {
                balances: [
                    { asset: "BTC", free: "1.5", locked: "0.5" },
                    { asset: "ETH", free: "0", locked: "0" }
                ]
            }
        });

        const { getSpotBalances } = await import("../../src/trading/binance.js");
        const balances = await getSpotBalances();

        expect(axios).toHaveBeenCalledTimes(1);
        const call = axios.mock.calls[0][0];
        expect(call.method).toBe("GET");
        expect(call.url.startsWith("https://api.binance.com/api/v3/account?")).toBe(true);

        const query = call.url.split("?")[1];
        const params = new URLSearchParams(query);
        const signature = params.get("signature");
        params.delete("signature");
        const expectedSignature = fixedSignature(Object.fromEntries(params.entries()), "test-secret");
        expect(signature).toBe(expectedSignature);
        expect(call.headers).toEqual({ "X-MBX-APIKEY": "test-key" });
        expect(balances).toEqual([
            { asset: "BTC", free: 1.5, locked: 0.5, total: 2 }
        ]);
    });

    it("fetches margin account information with normalization", async () => {
        axios.mockResolvedValueOnce({
            data: {
                totalAssetOfBtc: "1.5",
                totalLiabilityOfBtc: "0.3",
                totalNetAssetOfBtc: "1.2",
                marginLevel: "5.0",
                userAssets: [
                    { asset: "USDT", free: "100", borrowed: "10", interest: "0.5", netAsset: "89.5" }
                ]
            }
        });

        const { getMarginAccount } = await import("../../src/trading/binance.js");
        const account = await getMarginAccount();

        expect(account.totalAssetOfBtc).toBe(1.5);
        expect(account.totalLiabilityOfBtc).toBe(0.3);
        expect(account.totalNetAssetOfBtc).toBe(1.2);
        expect(account.marginLevel).toBe(5);
        expect(account.userAssets).toEqual([
            { asset: "USDT", free: 100, borrowed: 10, interest: 0.5, netAsset: 89.5 }
        ]);
    });

    it("returns formatted margin positions", async () => {
        axios.mockResolvedValueOnce({
            data: [
                {
                    symbol: "BTCUSDT",
                    positionAmt: "0.01",
                    entryPrice: "25000",
                    markPrice: "26000",
                    unRealizedProfit: "100",
                    liquidationPrice: "20000",
                    marginType: "cross"
                }
            ]
        });

        const { getMarginPositionRisk } = await import("../../src/trading/binance.js");
        const positions = await getMarginPositionRisk();

        expect(positions).toEqual([
            {
                symbol: "BTCUSDT",
                positionAmt: 0.01,
                entryPrice: 25000,
                markPrice: 26000,
                unrealizedProfit: 100,
                liquidationPrice: 20000,
                marginType: "cross"
            }
        ]);
    });

    it("aggregates account overview", async () => {
        axios
            .mockResolvedValueOnce({ data: [{ asset: "BTC" }] })
            .mockResolvedValueOnce({ data: { balances: [] } })
            .mockResolvedValueOnce({
                data: {
                    totalAssetOfBtc: "0.5",
                    totalLiabilityOfBtc: "0.1",
                    totalNetAssetOfBtc: "0.4",
                    marginLevel: "3",
                    userAssets: []
                }
            })
            .mockResolvedValueOnce({ data: [] });

        const { getAccountOverview } = await import("../../src/trading/binance.js");
        const overview = await getAccountOverview();

        expect(overview).toEqual({
            assets: [{ asset: "BTC" }],
            spotBalances: [],
            marginAccount: {
                totalAssetOfBtc: 0.5,
                totalLiabilityOfBtc: 0.1,
                totalNetAssetOfBtc: 0.4,
                marginLevel: 3,
                userAssets: []
            },
            marginPositions: []
        });
        expect(axios).toHaveBeenCalledTimes(4);
    });

    it("returns partial overview when optional sections fail", async () => {
        const assetsError = Object.assign(new Error("IP banned"), { response: { status: 403, data: { code: -2015 } } });
        const marginError = Object.assign(new Error("Margin disabled"), { response: { status: 403, data: { code: -3008 } } });
        axios
            .mockRejectedValueOnce(assetsError)
            .mockResolvedValueOnce({ data: { balances: [] } })
            .mockRejectedValueOnce(marginError)
            .mockResolvedValueOnce({ data: [{ symbol: "BTCUSDT", positionAmt: "0", entryPrice: "0", markPrice: "0", unRealizedProfit: "0", liquidationPrice: "0", marginType: "cross" }] });

        const { getAccountOverview } = await import("../../src/trading/binance.js");
        const overview = await getAccountOverview();

        expect(overview.assets).toEqual([]);
        expect(overview.spotBalances).toEqual([]);
        expect(overview.marginAccount).toBeNull();
        expect(overview.marginPositions).toEqual([
            {
                symbol: "BTCUSDT",
                positionAmt: 0,
                entryPrice: 0,
                markPrice: 0,
                unrealizedProfit: 0,
                liquidationPrice: 0,
                marginType: "cross",
            }
        ]);

        const overviewSections = withContextMock.mock.calls
            .filter(([, ctx]) => ctx?.scope === "accountOverview")
            .map(([, ctx]) => ctx.section);
        expect(overviewSections).toEqual(expect.arrayContaining(["assets", "marginAccount"]));
        expect(loggerMock.warn).toHaveBeenCalledTimes(2);
    });

    it("propagates errors when every overview section fails", async () => {
        const failure = new Error("network down");
        axios.mockRejectedValue(failure);

        const { getAccountOverview } = await import("../../src/trading/binance.js");
        await expect(getAccountOverview()).rejects.toThrow("network down");
    });

    it("submits generic order and records fill price", async () => {
        axios.mockResolvedValueOnce({
            data: {
                orderId: 123,
                fills: [
                    { price: "100", qty: "0.4" },
                    { price: "102", qty: "0.6" }
                ]
            }
        });

        const { submitOrder } = await import("../../src/trading/binance.js");
        const response = await submitOrder({
            symbol: "BTCUSDT",
            side: "BUY",
            type: "LIMIT",
            quantity: 1,
            price: 101,
            params: { timeInForce: "GTC" }
        });

        expect(response.fillPrice).toBeCloseTo(101.2);
        expect(logTradeMock).toHaveBeenCalledTimes(1);
        const payload = logTradeMock.mock.calls[0][0];
        expect(payload).toMatchObject({
            id: 123,
            symbol: "BTCUSDT",
            side: "BUY",
            quantity: 1,
            type: "LIMIT"
        });
        expect(payload.entry).toBeCloseTo(101.2);
    });

    it("transfers margin between accounts", async () => {
        axios.mockResolvedValueOnce({ data: { tranId: 321 } });

        const { transferMargin } = await import("../../src/trading/binance.js");
        await transferMargin({ asset: "USDT", amount: 25, direction: "toSpot" });

        const call = axios.mock.calls[0][0];
        const url = new URL(call.url);
        expect(url.pathname).toBe("/sapi/v1/margin/transfer");
        expect(url.searchParams.get("type")).toBe("2");
        expect(url.searchParams.get("asset")).toBe("USDT");
        expect(url.searchParams.get("amount")).toBe("25");
    });

    it("borrows and repays margin assets", async () => {
        axios
            .mockResolvedValueOnce({ data: { tranId: 1 } })
            .mockResolvedValueOnce({ data: { tranId: 2 } });

        const { borrowMargin, repayMargin } = await import("../../src/trading/binance.js");
        await borrowMargin({ asset: "BTC", amount: 0.1 });
        await repayMargin({ asset: "BTC", amount: 0.05 });

        const borrowCall = axios.mock.calls[0][0];
        const borrowUrl = new URL(borrowCall.url);
        expect(borrowUrl.pathname).toBe("/sapi/v1/margin/loan");
        expect(borrowUrl.searchParams.get("asset")).toBe("BTC");
        expect(borrowUrl.searchParams.get("amount")).toBe("0.1");

        const repayCall = axios.mock.calls[1][0];
        const repayUrl = new URL(repayCall.url);
        expect(repayUrl.pathname).toBe("/sapi/v1/margin/repay");
        expect(repayUrl.searchParams.get("asset")).toBe("BTC");
        expect(repayUrl.searchParams.get("amount")).toBe("0.05");
    });

    it("validates margin amounts", async () => {
        const { transferMargin } = await import("../../src/trading/binance.js");
        await expect(transferMargin({ asset: "USDT", amount: 0 })).rejects.toThrow("Invalid margin amount");
    });
});
