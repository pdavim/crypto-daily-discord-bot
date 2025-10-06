import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const axiosGetMock = vi.fn();
const axiosPostMock = vi.fn();
vi.mock("axios", () => ({
    default: {
        get: axiosGetMock,
        post: axiosPostMock,
    },
}));

const parseUrlMock = vi.fn();
vi.mock("rss-parser", () => {
    const ParserMock = vi.fn().mockImplementation(() => ({
        parseURL: parseUrlMock,
    }));
    return { default: ParserMock };
});

const translateMock = vi.fn();
vi.mock("@vitalets/google-translate-api", () => ({
    default: translateMock,
}));

const classifySentimentsLocalMock = vi.fn();
const normalizeSentimentMock = vi.fn();
const clampSentimentMock = vi.fn();
vi.mock("../src/sentiment.js", () => ({
    classifySentimentsLocal: classifySentimentsLocalMock,
    normalizeSentiment: normalizeSentimentMock,
    clampSentiment: clampSentimentMock,
}));

const fetchWithRetryMock = vi.fn();
vi.mock("../src/utils.js", () => ({
    fetchWithRetry: fetchWithRetryMock,
}));

const filterFreshNewsItemsMock = vi.fn();
const markNewsItemsAsSeenMock = vi.fn();
vi.mock("../src/newsCache.js", () => ({
    filterFreshNewsItems: filterFreshNewsItemsMock,
    markNewsItemsAsSeen: markNewsItemsAsSeenMock,
}));

const loggerMock = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
};
const withContextMock = vi.fn(() => loggerMock);
vi.mock("../src/logger.js", () => ({
    logger: loggerMock,
    withContext: withContextMock,
}));

const configMock = { serpapiApiKey: "test-serp-key" };
const CFGMock = {};
vi.mock("../src/config.js", () => ({
    config: configMock,
    CFG: CFGMock,
}));

const callOpenRouterMock = vi.fn();
vi.mock("../src/ai.js", () => ({
    callOpenRouter: callOpenRouterMock,
}));

const readFileMock = vi.fn();
const writeFileMock = vi.fn();
vi.mock("node:fs/promises", () => ({
    readFile: readFileMock,
    writeFile: writeFileMock,
}));

describe("getAssetNews", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        axiosGetMock.mockReset();
        axiosPostMock.mockReset();
        parseUrlMock.mockReset();
        translateMock.mockReset();
        classifySentimentsLocalMock.mockReset();
        normalizeSentimentMock.mockReset();
        clampSentimentMock.mockReset();
        fetchWithRetryMock.mockReset();
        filterFreshNewsItemsMock.mockReset();
        markNewsItemsAsSeenMock.mockReset();
        withContextMock.mockClear();
        readFileMock.mockReset();
        writeFileMock.mockReset();
        callOpenRouterMock.mockReset();
        Object.keys(CFGMock).forEach((key) => delete CFGMock[key]);
        Object.assign(configMock, { serpapiApiKey: "test-serp-key" });
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("dedupes news, falls back on translation errors, computes weighted sentiment, and caches results", async () => {
        readFileMock.mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "ENOENT" }));
        fetchWithRetryMock.mockImplementation(async (task) => task());
        axiosGetMock.mockResolvedValue({
            data: {
                news_results: [
                    {
                        title: "Bitcoin jumps above 40k",
                        source: "CoinDesk",
                        link: "https://coindesk.com/article-1",
                        date: "2024-01-01T00:00:00Z",
                        snippet: "Serp snippet one",
                    },
                    {
                        title: "Bitcoin jumps above 41k as rally continues",
                        source: "Example",
                        link: "https://example.com/article-duplicate",
                        date: "2024-01-01T00:00:00Z",
                        snippet: "Duplicate serp snippet",
                    },
                    {
                        title: "Ethereum edges higher on upgrades",
                        source: "CryptoFeed",
                        link: "https://cryptosite.com/eth",
                        date: "2024-01-01T00:00:00Z",
                        snippet: "Serp snippet two",
                    },
                ],
            },
        });
        parseUrlMock.mockResolvedValue({ items: [] });
        translateMock.mockImplementation(async (text, options) => {
            if (options?.to === "pt") {
                throw new Error("translation failed");
            }
            return {
                text: `${text} [${options?.to}]`,
                from: { language: { iso: "es" } },
            };
        });
        classifySentimentsLocalMock.mockResolvedValue([0.4, -0.6]);
        clampSentimentMock.mockImplementation((value) => value);
        normalizeSentimentMock.mockImplementation((value) => value);
        filterFreshNewsItemsMock.mockImplementation(async (items) => items);
        markNewsItemsAsSeenMock.mockResolvedValue();
        CFGMock.sentimentProvider = "tfjs";
        CFGMock.openrouterApiKey = null;
        CFGMock.rssSources = {
            BTC: [
                {
                    url: "https://rss.test/feed.xml",
                    name: "CryptoFeed",
                },
            ],
        };

        const { getAssetNews } = await import("../src/news.js");
        const result = await getAssetNews({ symbol: "BTC", lookbackHours: 24, limit: 2 });

        expect(fetchWithRetryMock).toHaveBeenCalledTimes(2);
        expect(parseUrlMock).toHaveBeenCalledTimes(1);
        expect(filterFreshNewsItemsMock).toHaveBeenCalledTimes(1);
        expect(filterFreshNewsItemsMock.mock.calls[0][0].map((item) => item.title)).toEqual([
            "Bitcoin jumps above 40k",
            "Ethereum edges higher on upgrades",
        ]);
        expect(result.items).toHaveLength(2);
        expect(result.items[0].translations.title.en).toBe("Bitcoin jumps above 40k [en]");
        expect(result.items[0].translations.title.pt).toBe("Bitcoin jumps above 40k");
        expect(result.items[0].translations.snippet.pt).toBe("Serp snippet one");
        expect(result.avgSentiment).toBeCloseTo(-0.1, 5);
        expect(result.weightedSentiment).toBeCloseTo(-0.0545454545, 5);
        expect(writeFileMock).toHaveBeenCalledTimes(1);
        expect(writeFileMock.mock.calls[0][0]).toBeInstanceOf(URL);
        expect(writeFileMock.mock.calls[0][0].pathname).toMatch(/\/?data\/news-cache\.json$/);
        expect(readFileMock).toHaveBeenCalledTimes(1);
        expect(readFileMock.mock.calls[0][0]).toBeInstanceOf(URL);
        expect(readFileMock.mock.calls[0][0].pathname).toMatch(/\/?data\/news-cache\.json$/);

        const cached = await getAssetNews({ symbol: "BTC", lookbackHours: 24, limit: 2 });
        expect(fetchWithRetryMock).toHaveBeenCalledTimes(2);
        expect(parseUrlMock).toHaveBeenCalledTimes(1);
        expect(cached).toEqual(result);
    });

    it("returns empty payload when no sources yield results", async () => {
        readFileMock.mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "ENOENT" }));
        fetchWithRetryMock.mockImplementation(async (task) => task());
        axiosGetMock.mockResolvedValue({ data: { news_results: [] } });
        CFGMock.rssSources = {};
        CFGMock.sentimentProvider = "tfjs";
        CFGMock.openrouterApiKey = null;
        translateMock.mockResolvedValue({ text: "" });
        filterFreshNewsItemsMock.mockImplementation(async (items) => items);
        markNewsItemsAsSeenMock.mockResolvedValue();
        clampSentimentMock.mockImplementation((value) => value);
        normalizeSentimentMock.mockImplementation((value) => value);

        const { getAssetNews } = await import("../src/news.js");
        const result = await getAssetNews({ symbol: "BTC", lookbackHours: 24, limit: 3 });

        expect(result).toEqual({ items: [], summary: "", avgSentiment: 0, weightedSentiment: 0 });
        expect(fetchWithRetryMock).toHaveBeenCalledTimes(1);
        expect(parseUrlMock).not.toHaveBeenCalled();
        expect(classifySentimentsLocalMock).not.toHaveBeenCalled();
        expect(writeFileMock).toHaveBeenCalledTimes(1);
        expect(writeFileMock.mock.calls[0][0]).toBeInstanceOf(URL);
        expect(writeFileMock.mock.calls[0][0].pathname).toMatch(/\/?data\/news-cache\.json$/);
    });

    it("falls back to concatenated headlines when OpenRouter summary fails", async () => {
        readFileMock.mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "ENOENT" }));
        fetchWithRetryMock.mockImplementation(async (task) => task());
        axiosGetMock.mockResolvedValue({
            data: {
                news_results: [
                    {
                        title: "Bitcoin jumps above 40k",
                        source: "CoinDesk",
                        link: "https://coindesk.com/article-1",
                        date: "2024-01-01T00:00:00Z",
                        snippet: "Serp snippet one",
                    },
                ],
            },
        });
        parseUrlMock.mockResolvedValue({ items: [] });
        translateMock.mockResolvedValue({
            text: "Bitcoin jumps above 40k",
            from: { language: { iso: "en" } },
        });
        classifySentimentsLocalMock.mockResolvedValue([0.5]);
        clampSentimentMock.mockImplementation((value) => value);
        normalizeSentimentMock.mockImplementation((value) => value);
        filterFreshNewsItemsMock.mockImplementation(async (items) => items);
        markNewsItemsAsSeenMock.mockResolvedValue();
        callOpenRouterMock.mockRejectedValue(new Error("summary failed"));
        CFGMock.sentimentProvider = "tfjs";
        CFGMock.openrouterApiKey = "openrouter-key";
        CFGMock.rssSources = {
            BTC: [
                {
                    url: "https://rss.test/feed.xml",
                    name: "CryptoFeed",
                },
            ],
        };

        const { getAssetNews } = await import("../src/news.js");
        const result = await getAssetNews({ symbol: "BTC", lookbackHours: 24, limit: 3 });

        expect(callOpenRouterMock).toHaveBeenCalledTimes(1);
        expect(result.summary).toBe("CoinDesk: Bitcoin jumps above 40k");
        expect(result.items).toHaveLength(1);
        expect(result.items[0].translations.title.en).toBe("Bitcoin jumps above 40k");
        expect(result.avgSentiment).toBe(0.5);
    });
});
