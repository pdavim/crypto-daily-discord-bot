import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCFG = {};
const axiosPost = vi.fn();
const fetchWithRetry = vi.fn((fn) => fn());
const buildSummaryPdf = vi.fn(async () => null);
const notifyOps = vi.fn();
const mkdir = vi.fn(async () => undefined);
const appendFile = vi.fn(async () => undefined);
const onConfigChange = vi.fn();

vi.mock("../../src/config.js", () => ({ CFG: mockCFG, onConfigChange }));
vi.mock("axios", () => ({ default: { post: axiosPost } }));
vi.mock("../../src/utils.js", () => ({ fetchWithRetry }));
vi.mock("../../src/reporter.js", () => ({ buildSummaryPdf }));
vi.mock("../../src/monitor.js", () => ({ notifyOps }));
vi.mock("../../src/logger.js", () => {
    const sink = {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
    };
    return {
        logger: sink,
        withContext: vi.fn(() => sink),
    };
});
vi.mock("fs", () => ({ promises: { mkdir, appendFile } }));

describe("postAnalysis webhook selection", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        for (const key of Object.keys(mockCFG)) {
            delete mockCFG[key];
        }
        axiosPost.mockResolvedValue({});
        fetchWithRetry.mockImplementation((fn) => fn());
        buildSummaryPdf.mockResolvedValue(null);
        onConfigChange.mockImplementation(() => undefined);
    });

    it("prefers asset-specific analysis webhooks when available", async () => {
        mockCFG.webhookAnalysis_BTC = "https://discord.test/analysis-btc";
        mockCFG.webhookAnalysis = "https://discord.test/analysis";
        mockCFG.webhookReports_BTC = "https://discord.test/reports-btc";

        const { postAnalysis } = await import("../../src/discord.js");
        const result = await postAnalysis("btc", "4h", "analysis text");

        expect(result.webhookConfigKey).toBe("webhookAnalysis_BTC");
        expect(axiosPost).toHaveBeenCalledWith("https://discord.test/analysis-btc", { content: "analysis text" });
    });

    it("falls back to the global analysis webhook before report channels", async () => {
        mockCFG.webhookAnalysis = "https://discord.test/analysis";
        mockCFG.webhookReports_BTC = "https://discord.test/reports-btc";
        mockCFG.webhookReports = "https://discord.test/reports";

        const { postAnalysis } = await import("../../src/discord.js");
        const result = await postAnalysis("btc", "1h", "analysis text");

        expect(result.webhookConfigKey).toBe("webhookAnalysis");
        expect(axiosPost).toHaveBeenCalledWith("https://discord.test/analysis", { content: "analysis text" });
    });

    it("falls back to asset report webhooks before general daily channels", async () => {
        mockCFG.webhookReports_BTC = "https://discord.test/reports-btc";
        mockCFG.webhookDaily = "https://discord.test/daily";

        const { postAnalysis } = await import("../../src/discord.js");
        const result = await postAnalysis("btc", "1h", "analysis text");

        expect(result.webhookConfigKey).toBe("webhookReports_BTC");
        expect(axiosPost).toHaveBeenCalledWith("https://discord.test/reports-btc", { content: "analysis text" });
    });

    it("uses the daily webhook for DAILY summaries when no analysis channel is configured", async () => {
        mockCFG.webhookReports = "https://discord.test/reports";
        mockCFG.webhookDaily = "https://discord.test/daily";

        const { postAnalysis } = await import("../../src/discord.js");
        const result = await postAnalysis("daily", "1d", "analysis text");

        expect(result.webhookConfigKey).toBe("webhookDaily");
        expect(axiosPost).toHaveBeenCalledWith("https://discord.test/daily", { content: "analysis text" });
    });

    it("returns delivery metadata needed for Sheets exports", async () => {
        mockCFG.webhookAnalysis = "https://discord.test/api/webhooks/321/analysis";

        const { postAnalysis } = await import("../../src/discord.js");
        const result = await postAnalysis("btc", "4h", "analysis text");

        expect(result).toEqual(expect.objectContaining({
            posted: true,
            webhookConfigKey: "webhookAnalysis",
            webhookUrl: "https://discord.test/api/webhooks/321/analysis",
            channelId: "321",
            attachments: [],
        }));
    });
});
