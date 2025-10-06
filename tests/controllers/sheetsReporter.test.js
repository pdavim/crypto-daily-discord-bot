import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const appendRowsMock = vi.fn(() => Promise.resolve());
const fetchWithRetryMock = vi.fn(fn => fn());
const metrics = {
    googleSheetsAppendAttemptCounter: { inc: vi.fn() },
    googleSheetsAppendSuccessCounter: { inc: vi.fn() },
    googleSheetsAppendFailureCounter: { inc: vi.fn() },
    googleSheetsAppendAttemptDurationHistogram: {
        startTimer: vi.fn(() => {
            const stop = vi.fn(() => 0.13);
            metrics.__attemptStop = stop;
            return stop;
        }),
    },
    googleSheetsAppendSuccessDurationHistogram: { observe: vi.fn() },
    googleSheetsAppendFailureDurationHistogram: { observe: vi.fn() },
};

const resetMetrics = () => {
    for (const value of Object.values(metrics)) {
        if (typeof value?.inc === "function") {
            value.inc.mockReset();
        }
        if (typeof value?.observe === "function") {
            value.observe.mockReset();
        }
    }
    metrics.googleSheetsAppendAttemptDurationHistogram.startTimer.mockReset().mockImplementation(() => {
        const stop = vi.fn(() => 0.13);
        metrics.__attemptStop = stop;
        return stop;
    });
    metrics.__attemptStop = undefined;
};

const logSink = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
};

vi.mock("../../src/googleSheets.js", () => ({ appendRows: appendRowsMock }));
vi.mock("../../src/utils.js", () => ({ fetchWithRetry: fetchWithRetryMock }));
vi.mock("../../src/logger.js", () => ({
    logger: logSink,
    withContext: vi.fn(() => logSink),
}));
vi.mock("../../src/metrics.js", () => metrics);
vi.mock("../../src/config.js", () => ({ CFG: {} }));

describe("sheetsReporter controller", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetMetrics();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.resetModules();
    });

    it("resolves sheet names using the channel map and flushes queued rows", async () => {
        const { CFG } = await import("../../src/config.js");
        CFG.googleSheets = {
            enabled: true,
            channelMap: {
                "123": "priority_channel",
            },
        };

        const { recordAlert } = await import("../../src/controllers/sheetsReporter.js");
        recordAlert({
            asset: "BTC",
            timeframe: "4h",
            scope: "aggregate",
            channelId: "123",
            content: "Alert message",
            metadata: { foo: "bar" },
            attachments: ["chart.png"],
        });

        await vi.runOnlyPendingTimersAsync();

        expect(fetchWithRetryMock).toHaveBeenCalledTimes(1);
        expect(appendRowsMock).toHaveBeenCalledWith({
            sheetName: "priority_channel",
            rows: expect.any(Array),
        });
        const appendedRows = appendRowsMock.mock.calls[0][0].rows;
        expect(appendedRows).toHaveLength(1);
        expect(appendedRows[0][1]).toBe("123");
        expect(metrics.googleSheetsAppendAttemptCounter.inc).toHaveBeenCalledWith({ sheet: "priority_channel", source: "sheetsReporter" });
        expect(metrics.googleSheetsAppendSuccessCounter.inc).toHaveBeenCalledWith({ sheet: "priority_channel", source: "sheetsReporter" });
    });

    it("flushes immediately when the batch size is reached", async () => {
        const { CFG } = await import("../../src/config.js");
        CFG.googleSheets = { enabled: true };

        const { recordDelivery } = await import("../../src/controllers/sheetsReporter.js");

        const payload = {
            asset: "ETH",
            timeframe: "1h",
            messageType: "rebalance",
            channelId: "channel-1",
            content: "Delivery",
        };

        for (let i = 0; i < 20; i += 1) {
            recordDelivery({ ...payload, metadata: { index: i } });
        }

        await Promise.resolve();

        expect(fetchWithRetryMock).toHaveBeenCalledTimes(1);
        expect(appendRowsMock).toHaveBeenCalledWith({
            sheetName: "rebalance",
            rows: expect.any(Array),
        });
        expect(appendRowsMock.mock.calls[0][0].rows).toHaveLength(20);
        expect(metrics.googleSheetsAppendAttemptCounter.inc).toHaveBeenCalledWith({ sheet: "rebalance", source: "sheetsReporter" });
        expect(metrics.googleSheetsAppendSuccessCounter.inc).toHaveBeenCalledWith({ sheet: "rebalance", source: "sheetsReporter" });
        expect(metrics.googleSheetsAppendAttemptDurationHistogram.startTimer).toHaveBeenCalledWith({ sheet: "rebalance", source: "sheetsReporter" });
    });

    it("acts as a no-op when the integration is disabled", async () => {
        const { CFG } = await import("../../src/config.js");
        CFG.googleSheets = { enabled: false };

        const { recordAlert, recordDelivery, recordAnalysisReport } = await import("../../src/controllers/sheetsReporter.js");

        recordAlert({ asset: "BTC", timeframe: "4h", scope: "aggregate" });
        recordDelivery({ asset: "BTC", timeframe: "4h", messageType: "custom" });
        recordAnalysisReport({ asset: "BTC", timeframe: "4h" });

        await vi.runAllTimersAsync();

        expect(fetchWithRetryMock).not.toHaveBeenCalled();
        expect(appendRowsMock).not.toHaveBeenCalled();
        expect(metrics.googleSheetsAppendAttemptCounter.inc).not.toHaveBeenCalled();
        expect(logSink.debug).not.toHaveBeenCalled();
    });
});
