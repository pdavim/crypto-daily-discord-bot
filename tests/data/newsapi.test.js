import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const axiosGet = vi.fn();
const fetchWithRetry = vi.fn(async (fn) => fn());

const loggerStub = {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
};

vi.mock("axios", () => ({ default: { get: axiosGet } }));
vi.mock("../../src/config.js", () => ({ config: { newsApiKey: "test-key" } }));
vi.mock("../../src/utils.js", () => ({ fetchWithRetry }));
vi.mock("../../src/logger.js", () => ({
    logger: loggerStub,
    withContext: vi.fn(() => loggerStub),
}));

describe("searchNews", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        axiosGet.mockResolvedValue({
            status: 200,
            data: {
                articles: [
                    {
                        title: "foo",
                        description: "bar",
                        url: "https://example.com/foo",
                        source: { name: "Example" },
                        publishedAt: "2024-01-02T03:04:05Z",
                    },
                ],
            },
        });
    });

    afterEach(() => {
        vi.resetModules();
    });

    it("uses fetchWithRetry and emits attempt/success logs", async () => {
        const { searchNews } = await import("../../src/data/newsapi.js");

        const articles = await searchNews("BTC");

        expect(fetchWithRetry).toHaveBeenCalledTimes(1);
        expect(axiosGet).toHaveBeenCalledTimes(1);
        expect(loggerStub.debug).toHaveBeenCalledWith({ attempt: 1 }, 'Requesting headlines from NewsAPI');
        expect(loggerStub.info).toHaveBeenCalledWith({ attempt: 1, status: 200, articles: 1 }, 'NewsAPI request succeeded');
        expect(loggerStub.error).not.toHaveBeenCalled();
        expect(articles).toEqual([
            {
                title: "foo",
                description: "bar",
                url: "https://example.com/foo",
                source: "Example",
                publishedAt: "2024-01-02T03:04:05Z",
            },
        ]);
    });
});
