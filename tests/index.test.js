import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const scheduledTasks = [];
const logStore = [];
const cfgMock = {
    analysisFrequency: "hourly",
    dailyReportHour: "8",
    tz: "UTC",
    enableCharts: false,
    enableAlerts: false,
    enableAnalysis: false,
    enableReports: false,
    forecasting: { charts: { appendToUploads: false } },
    portfolioGrowth: { discord: { enabled: false } },
    indicators: {
        smaPeriods: { ma20: 20, ma50: 50, ma100: 100, ma200: 200 },
        rsiPeriod: 14,
        macd: { fast: 12, slow: 26, signal: 9 },
        bollinger: { period: 20, multiplier: 2 },
        keltner: { period: 20, multiplier: 1.5 },
        adxPeriod: 14,
        atrPeriod: 14,
        bollWidth: 1,
        stochastic: { kPeriod: 14, dPeriod: 3 },
        williamsPeriod: 14,
        cciPeriod: 20,
        emaPeriods: { ema9: 9, ema21: 21 },
    },
    marketPosture: {},
};

const runAssetsSafelyMock = vi.fn(() => Promise.resolve());
const flushAlertQueueMock = vi.fn(() => Promise.resolve());
const runPortfolioGrowthSimulationMock = vi.fn(() => Promise.resolve(null));
const postChartsMock = vi.fn(() => Promise.resolve(true));
const sendDiscordAlertMock = vi.fn(() => Promise.resolve({ delivered: true, webhookUrl: "https://example.com", channelId: "123" }));
const sendDiscordAlertWithAttachmentsMock = vi.fn(() => Promise.resolve({ delivered: true, webhookUrl: "https://example.com", channelId: "123" }));
const postAnalysisMock = vi.fn(() => Promise.resolve({ posted: true, webhookConfigKey: "webhookAnalysis", webhookUrl: "https://example.com", channelId: "123", attachments: [] }));
const postMonthlyReportMock = vi.fn(() => Promise.resolve({ posted: true, webhookConfigKey: "webhookMonthly", webhookUrl: "https://example.com", channelId: "123", attachments: [] }));
const notifyOpsMock = vi.fn(() => Promise.resolve());
const fetchDailyClosesMock = vi.fn(() => Promise.resolve([{ t: new Date(), o: 1, h: 1, l: 1, c: 1, v: 1 }]));
const fetchOHLCVMock = vi.fn(() => Promise.resolve([]));
const streamKlinesMock = vi.fn();
const registerMock = {
    contentType: "text/plain",
    metrics: vi.fn(() => Promise.resolve("metrics")),
};
const reportWeeklyPerfMock = vi.fn(() => ({}));
const saveWeeklySnapshotMock = vi.fn(() => Promise.resolve());
const renderMonthlyPerformanceChartMock = vi.fn(() => Promise.resolve(null));
const fetchEconomicEventsMock = vi.fn(() => Promise.resolve([]));
const runAgentMock = vi.fn(() => Promise.resolve("report"));
const pruneOlderThanMock = vi.fn();
const resetAlertHashesMock = vi.fn();
const saveStoreMock = vi.fn();
const updateSignatureMock = vi.fn();
const getSignatureMock = vi.fn(() => null);
const buildHashMock = vi.fn(() => "hash");
const getAlertHashMock = vi.fn(() => "prev");
const updateAlertHashMock = vi.fn();
const forecastNextCloseMock = vi.fn();
const persistForecastEntryMock = vi.fn();
const buildSnapshotForReportMock = vi.fn(() => ({}));
const buildSummaryMock = vi.fn(() => "summary");

const createLogger = (context = {}) => ({
    info: vi.fn((metaOrMessage, maybeMessage) => {
        if (typeof metaOrMessage === "string") {
            logStore.push({ level: "info", context, message: metaOrMessage, meta: undefined });
            return;
        }
        logStore.push({ level: "info", context, message: maybeMessage, meta: metaOrMessage });
    }),
    warn: vi.fn((metaOrMessage, maybeMessage) => {
        if (typeof metaOrMessage === "string") {
            logStore.push({ level: "warn", context, message: metaOrMessage, meta: undefined });
            return;
        }
        logStore.push({ level: "warn", context, message: maybeMessage, meta: metaOrMessage });
    }),
    error: vi.fn((metaOrMessage, maybeMessage) => {
        if (typeof metaOrMessage === "string") {
            logStore.push({ level: "error", context, message: metaOrMessage, meta: undefined });
            return;
        }
        logStore.push({ level: "error", context, message: maybeMessage, meta: metaOrMessage });
    }),
    debug: vi.fn(),
});

const baseLogger = createLogger();

const scheduleMock = vi.fn((expression, handler, options) => {
    scheduledTasks.push({ expression, handler, options });
    return { stop: vi.fn() };
});

const listenMock = vi.fn((_, callback) => {
    if (typeof callback === "function") {
        callback();
    }
});

vi.mock("node-cron", () => ({ default: { schedule: scheduleMock } }));
vi.mock("http", () => ({ createServer: vi.fn(() => ({ listen: listenMock })), default: { createServer: vi.fn(() => ({ listen: listenMock })) } }));
const onConfigChangeMock = vi.fn(() => () => {});
vi.mock("../src/config.js", () => ({ CFG: cfgMock, onConfigChange: onConfigChangeMock }));
vi.mock("../src/assets.js", () => ({
    ASSETS: [{ key: "BTC", binance: "BTCUSDT" }],
    TIMEFRAMES: ["1h", "4h"],
    BINANCE_INTERVALS: { "1h": "1h", "4h": "4h" },
}));
vi.mock("../src/data/binance.js", () => ({
    fetchOHLCV: fetchOHLCVMock,
    fetchDailyCloses: fetchDailyClosesMock,
}));
vi.mock("../src/data/binanceStream.js", () => ({ streamKlines: streamKlinesMock }));
vi.mock("../src/indicators.js", () => ({
    sma: vi.fn(() => []),
    rsi: vi.fn(() => []),
    macd: vi.fn(() => ({ macd: [], signal: [], histogram: [] })),
    bollinger: vi.fn(() => ({ upper: [], lower: [], mid: [] })),
    atr14: vi.fn(() => []),
    bollWidth: vi.fn(() => []),
    vwap: vi.fn(() => []),
    ema: vi.fn(() => []),
    adx: vi.fn(() => []),
    stochastic: vi.fn(() => ({ k: [], d: [] })),
    williamsR: vi.fn(() => []),
    cci: vi.fn(() => []),
    obv: vi.fn(() => []),
    keltnerChannel: vi.fn(() => ({ upper: [], lower: [], mid: [] })),
}));
vi.mock("../src/reporter.js", () => ({
    buildSnapshotForReport: buildSnapshotForReportMock,
    buildSummary: buildSummaryMock,
}));
vi.mock("../src/discord.js", () => ({
    postAnalysis: postAnalysisMock,
    sendDiscordAlert: sendDiscordAlertMock,
    sendDiscordAlertWithAttachments: sendDiscordAlertWithAttachmentsMock,
    postMonthlyReport: postMonthlyReportMock,
}));
vi.mock("../src/discordBot.js", () => ({
    initBot: vi.fn(),
    postCharts: postChartsMock,
}));
vi.mock("../src/chart.js", () => ({
    renderChartPNG: vi.fn(() => Promise.resolve("chart.png")),
    renderForecastChart: vi.fn(() => Promise.resolve("forecast.png")),
}));
vi.mock("../src/alerts.js", () => ({ buildAlerts: vi.fn(() => []) }));
vi.mock("../src/ai.js", () => ({ runAgent: runAgentMock }));
vi.mock("../src/store.js", () => ({
    getSignature: getSignatureMock,
    updateSignature: updateSignatureMock,
    saveStore: saveStoreMock,
    getAlertHash: getAlertHashMock,
    updateAlertHash: updateAlertHashMock,
    resetAlertHashes: resetAlertHashesMock,
}));
vi.mock("../src/data/economic.js", () => ({ fetchEconomicEvents: fetchEconomicEventsMock }));
vi.mock("../src/logger.js", () => ({
    logger: baseLogger,
    withContext: vi.fn((_, context = {}) => createLogger(context)),
}));
vi.mock("../src/limit.js", () => ({
    default: vi.fn(() => vi.fn()),
    calcConcurrency: vi.fn(() => 2),
}));
vi.mock("../src/alertCache.js", () => ({
    buildHash: buildHashMock,
    shouldSend: vi.fn(() => true),
    pruneOlderThan: pruneOlderThanMock,
}));
vi.mock("../src/metrics.js", () => ({
    register: registerMock,
    forecastConfidenceHistogram: vi.fn(),
    forecastDirectionCounter: vi.fn(),
    forecastErrorHistogram: vi.fn(),
}));
vi.mock("../src/monitor.js", () => ({ notifyOps: notifyOpsMock }));
vi.mock("../src/perf.js", () => ({ reportWeeklyPerf: reportWeeklyPerfMock }));
vi.mock("../src/weeklySnapshots.js", () => ({
    saveWeeklySnapshot: saveWeeklySnapshotMock,
    loadWeeklySnapshots: vi.fn(() => Promise.resolve([])),
}));
vi.mock("../src/monthlyReport.js", () => ({ renderMonthlyPerformanceChart: renderMonthlyPerformanceChartMock }));
vi.mock("../src/runner.js", () => ({ runAssetsSafely: runAssetsSafelyMock }));
vi.mock("../src/alerts/dispatcher.js", () => ({
    enqueueAlertPayload: vi.fn(),
    flushAlertQueue: flushAlertQueueMock,
}));
vi.mock("../src/alerts/messageBuilder.js", () => ({
    buildAssetAlertMessage: vi.fn(() => ({})),
    buildAssetGuidanceMessage: vi.fn(() => ({})),
}));
vi.mock("../src/alerts/decision.js", () => ({ deriveDecisionDetails: vi.fn(() => ({})) }));
vi.mock("../src/alerts/variationMetrics.js", () => ({ collectVariationMetrics: vi.fn(() => ({})) }));
vi.mock("../src/trading/posture.js", () => ({
    evaluateMarketPosture: vi.fn(() => ({})),
    deriveStrategyFromPosture: vi.fn(() => ({})),
}));
vi.mock("../src/trading/automation.js", () => ({ automateTrading: vi.fn(() => Promise.resolve()) }));
vi.mock("../src/forecasting.js", () => ({
    forecastNextClose: forecastNextCloseMock,
    persistForecastEntry: persistForecastEntryMock,
}));
vi.mock("../src/portfolio/growth.js", () => ({ runPortfolioGrowthSimulation: runPortfolioGrowthSimulationMock }));
const recordAlertMock = vi.fn();
const recordDeliveryMock = vi.fn();
const recordAnalysisReportMock = vi.fn();
const recordMonthlyReportMock = vi.fn();
const recordPortfolioGrowthMock = vi.fn();
const recordChartUploadMock = vi.fn();

vi.mock("../src/controllers/sheetsReporter.js", () => ({
    recordAlert: recordAlertMock,
    recordDelivery: recordDeliveryMock,
    recordAnalysisReport: recordAnalysisReportMock,
    recordMonthlyReport: recordMonthlyReportMock,
    recordPortfolioGrowth: recordPortfolioGrowthMock,
    recordChartUpload: recordChartUploadMock,
}));

const originalArgv = [...process.argv];

describe("analysis scheduler", () => {

    beforeEach(() => {
        vi.resetModules();
        scheduledTasks.length = 0;
        logStore.length = 0;
        scheduleMock.mockClear();
        listenMock.mockClear();
        runAssetsSafelyMock.mockClear();
        flushAlertQueueMock.mockClear();
        runPortfolioGrowthSimulationMock.mockClear();
        postChartsMock.mockClear();
        sendDiscordAlertMock.mockClear();
        sendDiscordAlertWithAttachmentsMock.mockClear();
        postAnalysisMock.mockClear();
        postMonthlyReportMock.mockClear();
        notifyOpsMock.mockClear();
        fetchDailyClosesMock.mockClear();
        fetchOHLCVMock.mockClear();
        streamKlinesMock.mockClear();
        registerMock.metrics.mockClear();
        reportWeeklyPerfMock.mockClear();
        saveWeeklySnapshotMock.mockClear();
        renderMonthlyPerformanceChartMock.mockClear();
        fetchEconomicEventsMock.mockClear();
        runAgentMock.mockClear();
        pruneOlderThanMock.mockClear();
        resetAlertHashesMock.mockClear();
        saveStoreMock.mockClear();
        updateSignatureMock.mockClear();
        getSignatureMock.mockClear();
        buildHashMock.mockClear();
        getAlertHashMock.mockClear();
        updateAlertHashMock.mockClear();
        forecastNextCloseMock.mockClear();
        persistForecastEntryMock.mockClear();
        buildSnapshotForReportMock.mockClear();
        buildSummaryMock.mockClear();
        fetchOHLCVMock.mockImplementation(() => Promise.resolve([]));
        process.env.NODE_ENV = "test";
        process.argv = ["/usr/bin/node", "index.js"];
        cfgMock.analysisFrequency = "hourly";
        cfgMock.tz = "UTC";
        cfgMock.dailyReportHour = "8";
        recordAlertMock.mockClear();
        recordDeliveryMock.mockClear();
        recordAnalysisReportMock.mockClear();
        recordMonthlyReportMock.mockClear();
        recordPortfolioGrowthMock.mockClear();
        recordChartUploadMock.mockClear();
    });

    afterEach(() => {
        process.argv = originalArgv.slice();
    });

    it("schedules runAll according to analysisFrequency", async () => {
        cfgMock.analysisFrequency = "5m";

        await import("../src/index.js");

        const analysisTask = scheduledTasks.find((task) => task.expression === "*/5 * * * *");
        expect(analysisTask).toBeDefined();
        expect(analysisTask?.options).toEqual(expect.objectContaining({ timezone: cfgMock.tz }));

        expect(runAssetsSafelyMock).toHaveBeenCalledTimes(1);
        await analysisTask?.handler();
        expect(runAssetsSafelyMock).toHaveBeenCalledTimes(2);

        const startLog = logStore.find((entry) => entry.context?.fn === "analysisSchedule" && entry.message === "Starting scheduled runAll");
        const completedLog = logStore.find((entry) => entry.context?.fn === "analysisSchedule" && entry.message === "Completed scheduled runAll");
        expect(startLog).toBeDefined();
        expect(completedLog).toBeDefined();
        expect(completedLog?.meta?.durationMs).toBeGreaterThanOrEqual(0);

        const runAllStart = logStore.find((entry) => entry.context?.fn === "runAll" && entry.message === "Starting runAll job");
        const runAllFinish = logStore.find((entry) => entry.context?.fn === "runAll" && entry.message === "Finished runAll job");
        expect(runAllStart).toBeDefined();
        expect(runAllFinish).toBeDefined();
        expect(runAllFinish?.meta).toEqual(expect.objectContaining({ status: "success", durationMs: expect.any(Number) }));
    });

    it("falls back to hourly when the frequency is invalid", async () => {
        cfgMock.analysisFrequency = "weird";

        await import("../src/index.js");

        const analysisTask = scheduledTasks.find((task) => task.expression === "0 * * * *");
        expect(analysisTask).toBeDefined();

        const fallbackLog = logStore.find((entry) => entry.level === "warn" && entry.message === "Unknown analysis frequency \"weird\"; falling back to hourly cadence.");
        expect(fallbackLog).toBeDefined();
    });

    it("does not register the cron job when running in once mode", async () => {
        process.argv.push("--once");

        await import("../src/index.js");

        expect(scheduleMock).not.toHaveBeenCalled();
    });

    it("invokes the Sheets controller with delivery metadata when exports are enabled", async () => {
        cfgMock.googleSheets = { enabled: true };
        cfgMock.enableAnalysis = true;
        cfgMock.enableReports = true;
        cfgMock.enableAlerts = true;
        cfgMock.portfolioGrowth.discord = {
            enabled: true,
            webhookUrl: "https://discord.test/portfolio",
            channelId: "654",
            webhookKey: "portfolioWebhook",
        };

        const alertPayload = {
            asset: "BTC",
            timeframe: "aggregate",
            message: "Alert message",
            messageType: "aggregate_alert",
            metadata: { source: "alerts" },
            attachments: ["chart.png"],
            options: {
                webhookKey: "alertsWebhook",
                webhookUrl: "https://discord.test/custom-alerts",
                channelId: "123",
            },
        };
        const deliveryPayload = {
            asset: "BTC",
            timeframe: "1h",
            message: "Delivery message",
            messageType: "custom_event",
            metadata: { id: "evt-1" },
            attachments: [],
            options: {
                webhookKey: "customWebhook",
                webhookUrl: "https://discord.test/custom-delivery",
                channelId: "999",
            },
        };

        flushAlertQueueMock.mockImplementationOnce(async ({ sender }) => {
            await sender(alertPayload);
            await sender(deliveryPayload);
        });
        sendDiscordAlertMock.mockResolvedValue({ delivered: true, webhookUrl: "https://discord.test/alerts", channelId: "789" });
        sendDiscordAlertWithAttachmentsMock.mockResolvedValue({ delivered: true, webhookUrl: "https://discord.test/portfolio", channelId: "654" });

        postAnalysisMock.mockResolvedValue({
            posted: true,
            webhookConfigKey: "webhookAnalysis_BTC",
            webhookUrl: "https://discord.test/analysis",
            channelId: "321",
            attachments: ["analysis.pdf"],
            path: "reports/2024-01-01.txt",
        });

        runPortfolioGrowthSimulationMock.mockResolvedValue({
            discord: {
                message: "Portfolio growth summary",
                attachments: [{ filename: "growth-1.png" }, { filename: "growth-2.png" }],
            },
            uploads: [],
            reports: ["reports/growth.csv"],
        });

        fetchDailyClosesMock.mockResolvedValue([
            { t: new Date("2024-01-01T00:00:00Z"), o: 1, h: 1, l: 1, c: 1, v: 1 },
            { t: new Date("2024-01-02T00:00:00Z"), o: 1, h: 1, l: 1, c: 1, v: 1 },
        ]);
        getSignatureMock.mockImplementation((key) => (key === "DAILY:1d" ? 0 : null));
        getAlertHashMock.mockReturnValue(null);
        buildHashMock.mockReturnValue("daily-hash");

        await import("../src/index.js");

        const analysisTask = scheduledTasks.find((task) => task.expression === "0 * * * *");
        expect(analysisTask).toBeDefined();
        await analysisTask?.handler();

        expect(recordAlertMock).toHaveBeenCalledWith(expect.objectContaining({
            asset: "BTC",
            timeframe: "aggregate",
            scope: "aggregate",
            content: "Alert message",
            attachments: ["chart.png"],
            metadata: { source: "alerts" },
            webhookKey: "alertsWebhook",
            webhookUrl: "https://discord.test/alerts",
            channelId: "789",
            timestamp: expect.any(Date),
        }));
        expect(recordDeliveryMock).toHaveBeenCalledWith(expect.objectContaining({
            asset: "BTC",
            timeframe: "1h",
            messageType: "custom_event",
            content: "Delivery message",
            metadata: { id: "evt-1" },
            webhookKey: "customWebhook",
            webhookUrl: "https://discord.test/alerts",
            channelId: "789",
            timestamp: expect.any(Date),
        }));
        expect(recordPortfolioGrowthMock).toHaveBeenCalledWith(expect.objectContaining({
            asset: "PORTFOLIO",
            timeframe: "growth",
            webhookKey: "portfolioWebhook",
            webhookUrl: "https://discord.test/portfolio",
            channelId: "654",
            content: "Portfolio growth summary",
            attachments: ["growth-1.png", "growth-2.png"],
            metadata: { reportPaths: ["reports/growth.csv"] },
            timestamp: expect.any(Date),
        }));

        const dailyTask = scheduledTasks.find((task) => task.expression === `0 ${cfgMock.dailyReportHour} * * *`);
        expect(dailyTask).toBeDefined();
        await dailyTask?.handler();

        expect(recordAnalysisReportMock).toHaveBeenCalledWith(expect.objectContaining({
            asset: "DAILY",
            timeframe: "1d",
            webhookKey: "webhookAnalysis_BTC",
            webhookUrl: "https://discord.test/analysis",
            channelId: "321",
            attachments: ["analysis.pdf"],
            content: expect.stringContaining("report"),
            timestamp: expect.any(Date),
        }));
    });
});

describe("job logging", () => {
    beforeEach(() => {
        vi.resetModules();
        scheduledTasks.length = 0;
        logStore.length = 0;
        scheduleMock.mockClear();
        fetchOHLCVMock.mockClear();
        process.env.NODE_ENV = "test";
        process.argv = ["/usr/bin/node", "index.js"];
        cfgMock.analysisFrequency = "hourly";
        cfgMock.dailyReportHour = "8";
        fetchOHLCVMock.mockImplementation(() => Promise.resolve([]));
        buildSnapshotForReportMock.mockClear();
        buildSummaryMock.mockClear();
    });

    afterEach(() => {
        process.argv = originalArgv.slice();
    });

    it("emits start and finish logs for cron handlers", async () => {
        await import("../src/index.js");

        const findTask = (expression) => scheduledTasks.find((task) => task.expression === expression);
        const runTaskAndCollect = async (expression) => {
            const task = findTask(expression);
            expect(task).toBeDefined();
            const startIdx = logStore.length;
            await task.handler();
            return logStore.slice(startIdx);
        };

        const dailyEntries = await runTaskAndCollect(`0 ${cfgMock.dailyReportHour} * * *`);
        const dailyStart = dailyEntries.find((entry) => entry.context?.fn === "runDailyAnalysis" && entry.message === "Starting daily analysis job");
        const dailyFinish = dailyEntries.find((entry) => entry.context?.fn === "runDailyAnalysis" && entry.message === "Finished daily analysis job");
        expect(dailyStart).toBeDefined();
        expect(dailyFinish?.meta).toEqual(expect.objectContaining({ status: "success", durationMs: expect.any(Number) }));

        const weeklyEntries = await runTaskAndCollect("0 18 * * 0");
        const weeklyStart = weeklyEntries.find((entry) => entry.context?.fn === "generateWeeklySnapshot" && entry.message === "Starting weekly snapshot job");
        const weeklyFinish = weeklyEntries.find((entry) => entry.context?.fn === "generateWeeklySnapshot" && entry.message === "Finished weekly snapshot job");
        expect(weeklyStart).toBeDefined();
        expect(weeklyFinish?.meta).toEqual(expect.objectContaining({ status: "success", durationMs: expect.any(Number) }));

        const monthlyEntries = await runTaskAndCollect("0 1 1 * *");
        const monthlyStart = monthlyEntries.find((entry) => entry.context?.fn === "compileMonthlyPerformanceReport" && entry.message === "Starting monthly performance report job");
        const monthlyFinish = monthlyEntries.find((entry) => entry.context?.fn === "compileMonthlyPerformanceReport" && entry.message === "Finished monthly performance report job");
        expect(monthlyStart).toBeDefined();
        expect(monthlyFinish?.meta).toEqual(expect.objectContaining({ status: "success", durationMs: expect.any(Number) }));
    });
});

describe("handleAnalysisSlashCommand", () => {

    beforeEach(() => {
        vi.resetModules();
        scheduledTasks.length = 0;
        logStore.length = 0;
        process.env.NODE_ENV = "test";
        process.argv = ["/usr/bin/node", "index.js"];
        cfgMock.analysisFrequency = "hourly";
        cfgMock.dailyReportHour = "8";
        fetchOHLCVMock.mockClear();
        fetchOHLCVMock.mockImplementation(() => Promise.resolve([]));
        getSignatureMock.mockClear();
        updateSignatureMock.mockClear();
        buildSnapshotForReportMock.mockClear();
        buildSummaryMock.mockClear();
        fetchDailyClosesMock.mockClear();
        notifyOpsMock.mockClear();
    });

    afterEach(() => {
        process.argv = originalArgv.slice();
    });

    it("returns a summary even when signatures already match", async () => {
        const now = Date.now();
        const oneHourCandles = Array.from({ length: 120 }, (_, index) => ({
            t: new Date(now - (119 - index) * 60 * 60 * 1000),
            o: 1,
            h: 1.5,
            l: 0.5,
            c: 100 + index,
            v: 10,
        }));
        const fourHourCandles = Array.from({ length: 120 }, (_, index) => ({
            t: new Date(now - (119 - index) * 4 * 60 * 60 * 1000),
            o: 1,
            h: 1.5,
            l: 0.5,
            c: 200 + index,
            v: 15,
        }));
        const lastOneHour = oneHourCandles.at(-1)?.t?.getTime?.() ?? now;
        const lastFourHour = fourHourCandles.at(-1)?.t?.getTime?.() ?? now;

        fetchOHLCVMock.mockImplementation((_, interval) => {
            if (interval === "1h") {
                return Promise.resolve(oneHourCandles);
            }
            if (interval === "4h") {
                return Promise.resolve(fourHourCandles);
            }
            return Promise.resolve([]);
        });
        getSignatureMock.mockImplementation((key) => {
            if (key === "BTC:1h") {
                return lastOneHour;
            }
            if (key === "BTC:4h") {
                return lastFourHour;
            }
            return null;
        });

        const module = await import("../src/index.js");
        const { handleAnalysisSlashCommand } = module;

        getSignatureMock.mockClear();
        updateSignatureMock.mockClear();
        fetchOHLCVMock.mockClear();
        buildSnapshotForReportMock.mockClear();
        buildSummaryMock.mockClear();
        fetchDailyClosesMock.mockClear();

        const summary = await handleAnalysisSlashCommand({
            asset: { key: "BTC", binance: "BTCUSDT" },
            timeframe: "4h",
        });

        expect(fetchDailyClosesMock).toHaveBeenCalled();
        expect(fetchOHLCVMock).toHaveBeenCalledTimes(2);
        expect(notifyOpsMock).not.toHaveBeenCalled();
        expect(buildSnapshotForReportMock).toHaveBeenCalledTimes(2);
        expect(buildSummaryMock).toHaveBeenCalledTimes(1);
        expect(summary).toBe("summary");
        expect(getSignatureMock).toHaveBeenCalledWith("BTC:1h");
        expect(getSignatureMock).toHaveBeenCalledWith("BTC:4h");
        expect(updateSignatureMock).toHaveBeenCalledWith("BTC:1h", lastOneHour);
        expect(updateSignatureMock).toHaveBeenCalledWith("BTC:4h", lastFourHour);
    });
});
