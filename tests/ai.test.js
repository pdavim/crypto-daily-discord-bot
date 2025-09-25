import { describe, expect, it, beforeEach, vi } from "vitest";

const mockCFG = {
    debug: false,
    openrouterApiKey: null,
    openrouterModel: "gpt-4",
};

const mockAssets = [];

const buildCandle = (index) => ({
    t: new Date(1700000000000 + index * 60_000),
    o: 100 + index,
    h: 101 + index,
    l: 99 + index,
    c: 100 + index,
    v: 10 + index,
});

const hourlyCandles = Array.from({ length: 260 }, (_, i) => buildCandle(i));
const dailyCandles = Array.from({ length: 60 }, (_, i) => ({
    t: new Date(1700000000000 + i * 86_400_000),
    o: 100 + i,
    h: 105 + i,
    l: 95 + i,
    c: 100 + i,
    v: 50 + i,
}));

const indicatorsStub = {
    sma: vi.fn(() => Array.from({ length: 260 }, () => 100)),
    rsi: vi.fn(() => Array.from({ length: 260 }, () => 55)),
    macd: vi.fn(() => ({
        macd: Array.from({ length: 260 }, () => 1),
        signal: Array.from({ length: 260 }, () => 0.5),
        hist: Array.from({ length: 260 }, () => 0.25),
    })),
    bollinger: vi.fn(() => ({
        upper: Array.from({ length: 260 }, () => 120),
        lower: Array.from({ length: 260 }, () => 80),
        mid: Array.from({ length: 260 }, () => 100),
    })),
    bollWidth: vi.fn(() => Array.from({ length: 260 }, () => 0.4)),
    atr14: vi.fn(() => Array.from({ length: 260 }, () => 1.5)),
    crossUp: vi.fn(() => false),
    crossDown: vi.fn(() => false),
    parabolicSAR: vi.fn(() => Array.from({ length: 260 }, () => 90)),
    semaforo: vi.fn(() => "🟢"),
    isBBSqueeze: vi.fn(() => false),
    sparkline: vi.fn(() => "▁▃▅▇"),
    volumeDivergence: vi.fn(() => Array.from({ length: 260 }, () => 0.1)),
    trendFromMAs: vi.fn(() => 1),
    scoreHeuristic: vi.fn(() => 60),
    vwap: vi.fn(() => Array.from({ length: 260 }, () => 100)),
    ema: vi.fn(() => Array.from({ length: 260 }, () => 100)),
    stochastic: vi.fn(() => ({
        k: Array.from({ length: 260 }, () => 70),
        d: Array.from({ length: 260 }, () => 65),
    })),
    williamsR: vi.fn(() => Array.from({ length: 260 }, () => -20)),
    cci: vi.fn(() => Array.from({ length: 260 }, () => 30)),
    obv: vi.fn(() => Array.from({ length: 260 }, () => 10)),
};

vi.mock("../src/config.js", () => ({ CFG: mockCFG }));
vi.mock("../src/assets.js", () => ({ ASSETS: mockAssets }));
vi.mock("../src/data/binance.js", () => ({
    fetchOHLCV: vi.fn(async (symbol, timeframe) => {
        if (symbol === "EMPTY") {
            return [];
        }
        return timeframe === "1d" ? dailyCandles : hourlyCandles;
    }),
}));
vi.mock("../src/news.js", () => ({
    getAssetNews: vi.fn(async ({ symbol }) => ({
        summary: `News for ${symbol}`,
        weightedSentiment: 0.32,
    })),
}));
vi.mock("../src/websearch.js", () => ({
    searchWeb: vi.fn(async (query) => [`Snippet about ${query}`]),
}));
vi.mock("../src/alerts.js", () => ({
    buildAlerts: vi.fn(async () => [{ id: "alert-1" }]),
    formatAlertMessage: vi.fn(() => "Mock alert"),
}));
vi.mock("../src/logger.js", () => {
    const sink = {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    };
    return {
        logger: sink,
        withContext: vi.fn(() => sink),
    };
});
vi.mock("../src/indicators.js", () => indicatorsStub);
vi.mock("openai", () => ({
    default: class {
        constructor() {
            this.chat = {
                completions: {
                    create: vi.fn(async () => ({
                        choices: [
                            {
                                message: {
                                    content: "AI verdict",
                                },
                            },
                        ],
                    })),
                },
            };
        }
    },
}));

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockAssets.length = 0;
    mockCFG.openrouterApiKey = null;
    mockCFG.openrouterModel = "gpt-4";
});

describe("ai module", () => {
    it("throws when OpenRouter API key is missing", async () => {
        const { callOpenRouter } = await import("../src/ai.js");
        await expect(callOpenRouter([{ role: "user", content: "hello" }])).rejects.toThrow("OpenRouter API key missing");
    });

    it("invokes OpenRouter when credentials are configured", async () => {
        mockCFG.openrouterApiKey = "token";
        const { callOpenRouter } = await import("../src/ai.js");
        const result = await callOpenRouter([{ role: "user", content: "hello" }]);
        expect(result).toBe("AI verdict");
    });

    it("produces fallback content when asset lacks Binance symbol", async () => {
        mockAssets.push({ key: "NO_BINANCE", binance: null });
        const { runAgent } = await import("../src/ai.js");
        const output = await runAgent();
        expect(output).toContain("No Binance symbol configured.");
    });

    it("skips assets that return no candles", async () => {
        mockAssets.push({ key: "EMPTY", binance: "EMPTY" });
        const { runAgent } = await import("../src/ai.js");
        const output = await runAgent();
        expect(output).toContain("No candle data.");
    });

    it("combines indicators, alerts and context when data is available", async () => {
        mockAssets.push({ key: "BTC", binance: "BTCUSDT" });
        const { runAgent } = await import("../src/ai.js");
        const output = await runAgent();
        expect(output).toContain("**Alert Status:**");
        expect(output).toContain("Mock alert");
        expect(output).toContain("_This report is for educational purposes only");
    });
});
