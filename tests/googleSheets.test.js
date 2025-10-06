import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const metrics = {
    googleSheetsAppendAttemptCounter: { inc: vi.fn() },
    googleSheetsAppendSuccessCounter: { inc: vi.fn() },
    googleSheetsAppendFailureCounter: { inc: vi.fn() },
    googleSheetsAppendCounter: { inc: vi.fn() },
    googleSheetsAppendAttemptDurationHistogram: {
        startTimer: vi.fn(() => {
            const stop = vi.fn(() => 0.42);
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
        const stop = vi.fn(() => 0.42);
        metrics.__attemptStop = stop;
        return stop;
    });
    metrics.__attemptStop = undefined;
};

const appendMock = vi.fn(async () => ({ status: 200 }));
const readFileMock = vi.fn();
const fetchWithRetryMock = vi.fn(async fn => fn());
const googleSheetsMock = vi.fn(() => ({
    spreadsheets: {
        values: {
            append: appendMock,
        },
    },
}));
const googleAuthMock = vi.fn(params => ({ ...params }));

vi.mock("node:fs/promises", () => ({ readFile: readFileMock }));
vi.mock("../src/config.js", () => ({ CFG: {} }));
vi.mock("../src/metrics.js", () => metrics);
vi.mock("../src/utils.js", () => ({ fetchWithRetry: fetchWithRetryMock }));
vi.mock("../src/logger.js", () => {
    const sink = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    };
    return {
        logger: sink,
        withContext: vi.fn(() => sink),
    };
});
vi.mock("googleapis", () => ({
    google: {
        auth: { GoogleAuth: googleAuthMock },
        sheets: googleSheetsMock,
    },
}));

describe("googleSheets", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetMetrics();
    });

    afterEach(() => {
        vi.resetModules();
    });

    it("loads credentials from inline JSON when provided", async () => {
        const { CFG } = await import("../src/config.js");
        CFG.googleSheets = {
            enabled: true,
            credentialsJson: JSON.stringify({
                client_email: "bot@example.com",
                private_key: "-----BEGIN\\nKEY-----",
            }),
        };

        const { loadSheetsClient } = await import("../src/googleSheets.js");
        await loadSheetsClient();

        expect(readFileMock).not.toHaveBeenCalled();
        expect(googleAuthMock).toHaveBeenCalledWith(expect.objectContaining({
            credentials: expect.objectContaining({
                client_email: "bot@example.com",
                private_key: "-----BEGIN\nKEY-----",
            }),
            scopes: ["https://www.googleapis.com/auth/spreadsheets"],
        }));
        expect(googleSheetsMock).toHaveBeenCalledWith({ version: "v4", auth: expect.any(Object) });
    });

    it("loads credentials from a file when JSON is absent", async () => {
        readFileMock.mockResolvedValueOnce(JSON.stringify({
            client_email: "file@example.com",
            private_key: "MULTI\\nLINE",
        }));

        const { CFG } = await import("../src/config.js");
        CFG.googleSheets = {
            enabled: true,
            credentialsFile: "/tmp/creds.json",
        };

        const { loadSheetsClient } = await import("../src/googleSheets.js");
        await loadSheetsClient();

        expect(readFileMock).toHaveBeenCalledWith("/tmp/creds.json", "utf8");
        expect(googleAuthMock).toHaveBeenCalledWith(expect.objectContaining({
            credentials: expect.objectContaining({
                client_email: "file@example.com",
                private_key: "MULTI\nLINE",
            }),
        }));
    });

    it("emits metrics and retries around appendRows successes", async () => {
        const { CFG } = await import("../src/config.js");
        CFG.googleSheets = {
            enabled: true,
            spreadsheetId: "sheet-123",
            credentialsJson: JSON.stringify({ client_email: "bot@example.com", private_key: "key" }),
        };

        const { appendRows } = await import("../src/googleSheets.js");
        const response = await appendRows({ sheetName: "alerts", rows: [["a"], ["b"]] });

        expect(fetchWithRetryMock).toHaveBeenCalledTimes(1);
        const call = fetchWithRetryMock.mock.calls[0];
        expect(typeof call[0]).toBe("function");
        expect(call[1]).toBeUndefined();
        expect(appendMock).toHaveBeenCalledWith(expect.objectContaining({
            spreadsheetId: "sheet-123",
            range: "alerts",
            requestBody: { values: [["a"], ["b"]] },
        }));
        expect(response).toEqual({ status: 200 });

        const labels = { sheet: "alerts", source: "googleSheets" };
        expect(metrics.googleSheetsAppendAttemptCounter.inc).toHaveBeenCalledWith(labels);
        expect(metrics.googleSheetsAppendSuccessCounter.inc).toHaveBeenCalledWith(labels);
        expect(metrics.googleSheetsAppendCounter.inc).toHaveBeenCalledWith(labels, 2);
        expect(metrics.googleSheetsAppendAttemptDurationHistogram.startTimer).toHaveBeenCalledWith(labels);
        expect(metrics.googleSheetsAppendSuccessDurationHistogram.observe).toHaveBeenCalledWith(labels, 0.42);
        expect(metrics.googleSheetsAppendFailureCounter.inc).not.toHaveBeenCalled();
        expect(metrics.googleSheetsAppendFailureDurationHistogram.observe).not.toHaveBeenCalled();
    });

    it("increments failure metrics when appendRows throws", async () => {
        const error = new Error("boom");
        fetchWithRetryMock.mockImplementationOnce(async fn => {
            await fn();
            throw error;
        });

        const { CFG } = await import("../src/config.js");
        CFG.googleSheets = {
            enabled: true,
            spreadsheetId: "sheet-456",
            credentialsJson: JSON.stringify({ client_email: "bot@example.com", private_key: "key" }),
        };

        const { appendRows } = await import("../src/googleSheets.js");

        await expect(appendRows({ sheetName: "failures", rows: [["row"]] })).rejects.toThrow("boom");

        const labels = { sheet: "failures", source: "googleSheets" };
        expect(metrics.googleSheetsAppendAttemptCounter.inc).toHaveBeenCalledWith(labels);
        expect(metrics.googleSheetsAppendFailureCounter.inc).toHaveBeenCalledWith(labels);
        expect(metrics.googleSheetsAppendFailureDurationHistogram.observe).toHaveBeenCalledWith(labels, 0.42);
        expect(metrics.googleSheetsAppendSuccessCounter.inc).not.toHaveBeenCalled();
        expect(metrics.googleSheetsAppendSuccessDurationHistogram.observe).not.toHaveBeenCalled();
    });
});
