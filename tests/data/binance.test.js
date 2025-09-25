import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCFG = {
    binanceCacheTTL: 5,
    debug: false,
};

const axiosGet = vi.fn();
const fetchWithRetry = vi.fn(async (fn) => fn());
const recordPerf = vi.fn();

vi.mock("../../src/config.js", () => ({ CFG: mockCFG }));
vi.mock("axios", () => ({ default: { get: axiosGet } }));
vi.mock("../../src/utils.js", () => ({ fetchWithRetry }));
vi.mock("../../src/perf.js", () => ({ recordPerf }));
vi.mock("../../src/logger.js", () => {
    const sink = {
        info: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
    };
    return {
        logger: sink,
        withContext: vi.fn(() => sink),
    };
});

const mockCandles = [
    [1700000000000, "100", "110", "90", "105", "1200"],
    [1700000060000, "105", "112", "99", "108", "980"],
];

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    axiosGet.mockResolvedValue({ data: mockCandles });
});

describe("src/data/binance", () => {
    it("fetches OHLCV data and caches the response", async () => {
        const { fetchOHLCV } = await import("../../src/data/binance.js");
        const first = await fetchOHLCV("BTCUSDT", "1h");
        const second = await fetchOHLCV("BTCUSDT", "1h");

        expect(first).toHaveLength(2);
        expect(second).toBe(first);
        expect(axiosGet).toHaveBeenCalledTimes(1);
        expect(recordPerf).toHaveBeenCalledWith("fetchOHLCV", expect.any(Number));
    });

    it("marks Binance as offline when network errors occur", async () => {
        const offlineError = Object.assign(new Error("offline"), { code: "ENETUNREACH" });
        axiosGet.mockRejectedValueOnce(offlineError);
        const { fetchOHLCV } = await import("../../src/data/binance.js");

        await expect(fetchOHLCV("BTCUSDT", "1h")).rejects.toThrow("offline");
        await expect(fetchOHLCV("BTCUSDT", "1h")).rejects.toThrow("Binance API unavailable");
    });

    it("fetches and caches daily closes independently", async () => {
        const { fetchDailyCloses } = await import("../../src/data/binance.js");
        const first = await fetchDailyCloses("BTCUSDT", 10);
        const second = await fetchDailyCloses("BTCUSDT", 10);

        expect(first[0]).toMatchObject({ c: 105 });
        expect(second).toBe(first);
        expect(axiosGet).toHaveBeenCalledTimes(1);
    });
});
