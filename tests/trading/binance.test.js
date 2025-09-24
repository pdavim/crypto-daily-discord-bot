import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("axios", () => {
    const mock = vi.fn();
    return { default: mock };
});

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
});
