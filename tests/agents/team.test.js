import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCFG = {
    openrouterApiKey: "token",
    openrouterModel: "gpt-4",
    kaiban: {
        enabled: true,
        logLevel: "debug",
        maxIterations: 2,
        models: {
            technical: "model-technical",
            news: "model-news",
            sentiment: "model-sentiment",
            research: "model-research",
            trader: "model-trader",
            risk: "model-risk",
            execution: "model-execution",
        },
    },
};

const mockAssets = [
    {
        key: "BTC",
        exchange: "binance",
        symbol: "BTCUSDT",
        symbols: { market: "BTCUSDT" },
        capabilities: { candles: true, daily: true, forecasting: true },
    },
    {
        key: "ETH",
        exchange: "binance",
        symbol: "ETHUSDT",
        symbols: { market: "ETHUSDT" },
        capabilities: { candles: true, daily: true, forecasting: true },
    },
];

const buildCandle = (base, step) => ({
    t: new Date(base + step),
    o: 100 + step,
    h: 102 + step,
    l: 98 + step,
    c: 100 + step,
    v: 10 + step,
});

const hourlyCandles = Array.from({ length: 260 }, (_, index) => buildCandle(1700000000000, index * 60_000));
const dailyCandles = Array.from({ length: 60 }, (_, index) => ({
    t: new Date(1700000000000 + index * 86_400_000),
    o: 100 + index,
    h: 105 + index,
    l: 95 + index,
    c: 100 + index,
    v: 20 + index,
}));

const indicatorReturnArray = (value) => Array.from({ length: 260 }, () => value);

const indicatorsMock = {
    sma: vi.fn(() => indicatorReturnArray(100)),
    rsi: vi.fn(() => indicatorReturnArray(55)),
    macd: vi.fn(() => ({
        macd: indicatorReturnArray(1),
        signal: indicatorReturnArray(0.5),
        hist: indicatorReturnArray(0.25),
    })),
    bollinger: vi.fn(() => ({
        upper: indicatorReturnArray(120),
        lower: indicatorReturnArray(80),
        mid: indicatorReturnArray(100),
    })),
    bollWidth: vi.fn(() => indicatorReturnArray(0.4)),
    atr14: vi.fn(() => indicatorReturnArray(1.2)),
    parabolicSAR: vi.fn(() => indicatorReturnArray(90)),
    semaforo: vi.fn(() => "🟢"),
    isBBSqueeze: vi.fn(() => false),
    sparkline: vi.fn(() => "▁▃▅▇"),
    volumeDivergence: vi.fn(() => indicatorReturnArray(0.1)),
    trendFromMAs: vi.fn(() => 1),
    scoreHeuristic: vi.fn(() => 60),
    vwap: vi.fn(() => indicatorReturnArray(101)),
    ema: vi.fn(() => indicatorReturnArray(99)),
    stochastic: vi.fn(() => ({ k: indicatorReturnArray(70), d: indicatorReturnArray(65) })),
    williamsR: vi.fn(() => indicatorReturnArray(-20)),
    cci: vi.fn(() => indicatorReturnArray(30)),
    obv: vi.fn(() => indicatorReturnArray(10)),
};

const fetchOHLCVMock = vi.fn(async (assetOrSymbol, timeframe) => {
    const symbol = typeof assetOrSymbol === "string"
        ? assetOrSymbol
        : assetOrSymbol?.symbol ?? assetOrSymbol?.symbols?.market ?? "";
    if (symbol === "BTCUSDT" && timeframe === "1h") {
        return hourlyCandles;
    }
    if (symbol === "BTCUSDT" && timeframe === "1d") {
        return dailyCandles;
    }
    return [];
});

const getAssetNewsMock = vi.fn(async ({ symbol }) => ({
    summary: `News for ${symbol}`,
    weightedSentiment: 0.35,
    items: [
        { source: "SourceA", title: `${symbol} headline` },
        { source: "SourceB", title: `${symbol} update` },
    ],
}));

const searchWebMock = vi.fn(async (symbol) => [
    `${symbol} research snippet`,
    `${symbol} ecosystem note`,
]);

const loggerMock = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
};

const runHistory = [];
let mockTaskResults = {};
let mockWorkflowResult;
let mockStartError = null;

const storeStates = [];

class MockAgent {
    constructor(config) {
        this.config = config;
    }
}

let taskCounter = 0;
class MockTask {
    constructor(config) {
        this.config = config;
        this.id = config.id ?? `task-${++taskCounter}`;
    }
}

class MockTeam {
    constructor(config) {
        this.config = config;
        runHistory.push(config);
        this.state = {
            inputs: config.inputs ?? {},
            workflowLogs: [],
            getTaskResults: () => mockTaskResults,
            setInputs: (inputs) => {
                this.state.inputs = inputs;
            },
        };
        storeStates.push(this.state);
    }

    async start() {
        if (mockStartError) {
            throw mockStartError;
        }
        return mockWorkflowResult;
    }

    getStore() {
        return {
            getState: () => this.state,
        };
    }

    useStore() {
        return this.getStore();
    }
}

vi.mock("kaibanjs", () => ({ Agent: MockAgent, Task: MockTask, Team: MockTeam }));
vi.mock("../../src/config.js", () => ({ CFG: mockCFG }));
vi.mock("../../src/assets.js", () => ({
    DEFAULT_ASSETS: mockAssets,
    TIMEFRAMES: ["1h", "1d"],
    EXCHANGE_INTERVAL_OVERRIDES: {},
}));
vi.mock("../../src/data/marketData.js", () => ({ fetchOHLCV: fetchOHLCVMock }));
vi.mock("../../src/news.js", () => ({ getAssetNews: getAssetNewsMock }));
vi.mock("../../src/websearch.js", () => ({ searchWeb: searchWebMock }));
vi.mock("../../src/indicators.js", () => indicatorsMock);
vi.mock("../../src/logger.js", () => ({
    logger: loggerMock,
    withContext: vi.fn(() => loggerMock),
}));

const buildExecutionResult = () => ({
    generatedAt: "2024-01-01T00:00:00.000Z",
    report: "## Final Decision\n- BTC: Long bias",
    macro: "Calm markets",
    decisions: [
        {
            asset: "BTC",
            stance: "long",
            confidence: 0.62,
            timeframe: "1d",
            entry: "60000",
            takeProfit: "65000",
            stopLoss: "58000",
            positionSize: 0.1,
            rationale: "Mock rationale",
            riskNotes: ["Watch volatility"],
        },
    ],
    callToAction: "Monitor BTC levels",
});

const buildTaskResults = () => ({
    technical: {
        generatedAt: "2024-01-01T00:00:00.000Z",
        assets: [
            {
                asset: "BTC",
                horizon: "1d",
                bias: "bullish",
                confidence: 0.6,
                summary: "Momentum building",
                indicators: { rsi14: 55 },
                signals: ["Breakout"],
                riskFlags: [],
            },
        ],
    },
    news: {
        generatedAt: "2024-01-01T00:00:00.000Z",
        assets: [{ asset: "BTC", headlineSummary: "ETF inflows", catalysts: ["ETF"], sentimentScore: 0.3, sentimentLabel: "positive", riskWarnings: [] }],
    },
    sentiment: {
        generatedAt: "2024-01-01T00:00:00.000Z",
        assets: [{ asset: "BTC", sentimentScore: 0.4, sentimentLabel: "bullish", conviction: 0.7, drivers: ["Momentum"], commentary: "Positive" }],
        overallBias: "bullish",
        confidence: 0.6,
    },
    research: {
        generatedAt: "2024-01-01T00:00:00.000Z",
        assets: [{ asset: "BTC", thesis: "Institutional adoption", opportunities: ["ETF flows"], risks: ["Macro"], sources: ["SourceA"] }],
        marketThemes: ["Institutional"],
    },
    trader: {
        generatedAt: "2024-01-01T00:00:00.000Z",
        assets: [{ asset: "BTC", stance: "long", conviction: 0.65, timeframe: "1d", strategy: "Breakout", entry: "60000", takeProfit: "65000", stopLoss: "58000", catalysts: ["ETF"], invalidations: ["Macro"], rationale: "Momentum" }],
    },
    risk: {
        generatedAt: "2024-01-01T00:00:00.000Z",
        portfolio: { riskScore: 0.4, summary: "Balanced", cautions: ["Watch leverage"] },
        assets: [{ asset: "BTC", maxPositionPct: 0.1, stopLoss: "58000", takeProfit: "65000", riskNotes: ["Adjust stops"] }],
    },
    execution: buildExecutionResult(),
});

beforeEach(() => {
    vi.resetModules();
    runHistory.length = 0;
    storeStates.length = 0;
    fetchOHLCVMock.mockClear();
    getAssetNewsMock.mockClear();
    searchWebMock.mockClear();
    Object.values(indicatorsMock).forEach((fn) => fn.mockClear());
    mockCFG.assets = mockAssets.map(asset => ({ ...asset }));
    mockCFG.assetMap = new Map(mockCFG.assets.map(asset => [asset.key, asset]));
    Object.assign(mockCFG.kaiban, {
        enabled: true,
        logLevel: "debug",
        maxIterations: 2,
        models: { ...mockCFG.kaiban.models },
    });
    mockTaskResults = buildTaskResults();
    const executionResult = buildExecutionResult();
    mockWorkflowResult = {
        status: "COMPLETED",
        result: executionResult,
        stats: {
            startTime: 0,
            endTime: 1,
            duration: 1,
            llmUsageStats: {
                inputTokens: 10,
                outputTokens: 10,
                callsCount: 1,
                callsErrorCount: 0,
                parsingErrors: 0,
            },
            iterationCount: 1,
            costDetails: {
                costInputTokens: 0,
                costOutputTokens: 0,
                totalCost: 0,
            },
            teamName: "Test Team",
            taskCount: 7,
            agentCount: 7,
        },
    };
    mockStartError = null;
});

describe("Kaiban team workflow", () => {
    it("orchestrates tasks and returns normalized execution report", async () => {
        const { runKaibanWorkflow } = await import("../../src/agents/team.js");
        const result = await runKaibanWorkflow();

        expect(runHistory).toHaveLength(1);
        const teamConfig = runHistory[0];
        expect(teamConfig.tasks.map((task) => task.id)).toEqual([
            "technical",
            "news",
            "sentiment",
            "research",
            "trader",
            "risk",
            "execution",
        ]);
        expect(result.report).toBe("## Final Decision\n- BTC: Long bias");
        expect(result.taskResults).toEqual(mockTaskResults);
        expect(result.snapshot.assets).toHaveLength(2);
        expect(storeStates[0].inputs.snapshot).toBeDefined();
        expect(storeStates[0].inputs.taskResults).toEqual(mockTaskResults);
    });

    it("propagates errors when the team fails to start", async () => {
        mockStartError = new Error("Start failure");
        const { runKaibanWorkflow } = await import("../../src/agents/team.js");
        await expect(runKaibanWorkflow()).rejects.toThrow("Start failure");
    });

    it("collects market data using existing helpers", async () => {
        const { runKaibanWorkflow } = await import("../../src/agents/team.js");
        await runKaibanWorkflow();

        expect(fetchOHLCVMock).toHaveBeenCalledWith(expect.objectContaining({ key: "BTC" }), "1h");
        expect(fetchOHLCVMock).toHaveBeenCalledWith(expect.objectContaining({ key: "BTC" }), "1d");
        expect(getAssetNewsMock).toHaveBeenCalledWith({ symbol: "BTC" });
        expect(searchWebMock).toHaveBeenCalledWith("BTC");
        expect(indicatorsMock.sma).toHaveBeenCalled();
    });
});
