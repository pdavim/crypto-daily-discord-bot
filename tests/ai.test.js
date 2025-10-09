import { describe, expect, it, beforeEach, vi } from "vitest";

const mockCFG = {
    debug: false,
    openrouterApiKey: null,
    openrouterModel: "gpt-4",
    kaiban: {
        enabled: false,
        logLevel: "info",
        maxIterations: 3,
        models: {
            technical: "gpt-4",
            news: "gpt-4",
            sentiment: "gpt-4",
            research: "gpt-4",
            trader: "gpt-4",
            risk: "gpt-4",
            execution: "gpt-4",
        },
    },
};

const mockAssets = [];
const addAsset = (asset) => {
    mockAssets.push(asset);
    if (mockCFG.assetMap && typeof mockCFG.assetMap.set === "function") {
        mockCFG.assetMap.set(asset.key, asset);
    }
};

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

const runKaibanWorkflowMock = vi.fn();

vi.mock("../src/config.js", () => ({ CFG: mockCFG }));
vi.mock("../src/assets.js", () => ({
    DEFAULT_ASSETS: mockAssets,
    TIMEFRAMES: ["1h", "1d"],
    EXCHANGE_INTERVAL_OVERRIDES: {},
}));
vi.mock("../src/data/marketData.js", () => ({
    fetchOHLCV: vi.fn(async (assetOrSymbol, timeframe) => {
        const symbol = typeof assetOrSymbol === "string"
            ? assetOrSymbol
            : assetOrSymbol?.symbol ?? assetOrSymbol?.symbols?.market ?? "";
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
vi.mock("../src/agents/team.js", () => ({
    runKaibanWorkflow: runKaibanWorkflowMock,
}));
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
    mockCFG.assets = mockAssets;
    mockCFG.assetMap = new Map();
    mockCFG.openrouterApiKey = null;
    mockCFG.openrouterModel = "gpt-4";
    mockCFG.kaiban.enabled = false;
    runKaibanWorkflowMock.mockReset();
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
        addAsset({
            key: "NO_BINANCE",
            exchange: "binance",
            symbol: null,
            symbols: {},
        });
        const { runAgent } = await import("../src/ai.js");
        const output = await runAgent();
        expect(output).toContain("No market symbol configured.");
        expect(runKaibanWorkflowMock).not.toHaveBeenCalled();
    });

    it("skips assets that return no candles", async () => {
        addAsset({
            key: "EMPTY",
            exchange: "binance",
            symbol: "EMPTY",
            symbols: { market: "EMPTY" },
        });
        const { runAgent } = await import("../src/ai.js");
        const output = await runAgent();
        expect(output).toContain("No candle data.");
        expect(runKaibanWorkflowMock).not.toHaveBeenCalled();
    });

    it("combines indicators, alerts and context when data is available", async () => {
        addAsset({
            key: "BTC",
            exchange: "binance",
            symbol: "BTCUSDT",
            symbols: { market: "BTCUSDT" },
        });
        const { runAgent } = await import("../src/ai.js");
        const { getAssetNews } = await import("../src/news.js");
        const output = await runAgent();

        expect(output).toContain("**Alert Status:**");
        expect(output).toContain("Mock alert");
        expect(output).toContain("News for BTC");
        expect(output).toContain("- Weighted sentiment: 0.32");
        expect(output).toContain("**Macro**");
        expect(output).toContain("News for crypto market");
        expect(output).toContain("_This report is for educational purposes only");

        expect(getAssetNews).toHaveBeenCalledWith({ symbol: "crypto market" });
        const assetNewsCalls = getAssetNews.mock.calls.filter(([params]) => params.symbol !== "crypto market");
        expect(assetNewsCalls).toHaveLength(1);
        expect(assetNewsCalls[0][0]).toMatchObject({ symbol: "BTC" });
        expect(runKaibanWorkflowMock).not.toHaveBeenCalled();
    });

    it("uses Kaiban workflow when enabled", async () => {
        mockCFG.openrouterApiKey = "token";
        mockCFG.kaiban.enabled = true;
        runKaibanWorkflowMock.mockResolvedValue({ report: "# Kaiban" });

        const { runAgent } = await import("../src/ai.js");
        const output = await runAgent();

        expect(runKaibanWorkflowMock).toHaveBeenCalledTimes(1);
        expect(output).toBe("# Kaiban");
    });

    it("falls back to legacy analysis when Kaiban fails", async () => {
        mockCFG.openrouterApiKey = "token";
        mockCFG.kaiban.enabled = true;
        addAsset({
            key: "BTC",
            exchange: "binance",
            symbol: "BTCUSDT",
            symbols: { market: "BTCUSDT" },
        });
        runKaibanWorkflowMock.mockRejectedValue(new Error("Kaiban failed"));

        const { runAgent } = await import("../src/ai.js");
        const output = await runAgent();

        expect(runKaibanWorkflowMock).toHaveBeenCalledTimes(1);
        expect(output).toContain("**Alert Status:**");
    });
});
