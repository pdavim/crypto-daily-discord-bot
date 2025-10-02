import { beforeEach, describe, expect, it, vi } from "vitest";

const getJson = vi.fn();
const fetchWithRetry = vi.fn(async (fn) => fn());

const createLogger = () => ({
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
});

const withContextMock = vi.fn();

vi.mock("serpapi", () => ({ getJson }));
vi.mock("../../src/config.js", () => ({ config: { serpapiApiKey: "key" } }));
vi.mock("../../src/utils.js", () => ({ fetchWithRetry }));
vi.mock("../../src/logger.js", () => ({
    logger: createLogger(),
    withContext: withContextMock,
}));

describe("SerpAPI adapters", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        getJson.mockImplementation(async (params, callback) => {
            if (typeof callback === "function") {
                callback({ ping: true });
            }
            return { params };
        });
        withContextMock.mockImplementation(() => createLogger());
    });

    it("fetchNews logs attempts and success", async () => {
        const loggerInstance = createLogger();
        withContextMock.mockImplementationOnce(() => loggerInstance);
        getJson.mockResolvedValueOnce({ news_results: [{}, {}] });

        const { fetchNews } = await import("../../src/data/serpapi.js");
        const res = await fetchNews("prompt");

        expect(fetchWithRetry).toHaveBeenCalledTimes(1);
        expect(res).toEqual({ news_results: [{}, {}] });
        expect(loggerInstance.debug).toHaveBeenCalledWith({ attempt: 1 }, 'Requesting SerpAPI google_news results');
        expect(loggerInstance.info).toHaveBeenCalledWith({ attempt: 1, results: 2 }, 'SerpAPI google_news request succeeded');
    });

    it("searchWeb logs attempts and success", async () => {
        const loggerInstance = createLogger();
        withContextMock.mockImplementationOnce(() => loggerInstance);
        getJson.mockResolvedValueOnce({ organic_results: [{}, {}, {}] });

        const { searchWeb } = await import("../../src/data/serpapi.js");
        const res = await searchWeb("search");

        expect(fetchWithRetry).toHaveBeenCalledTimes(1);
        expect(res).toEqual({ organic_results: [{}, {}, {}] });
        expect(loggerInstance.debug).toHaveBeenCalledWith({ attempt: 1 }, 'Requesting SerpAPI google search results');
        expect(loggerInstance.info).toHaveBeenCalledWith({ attempt: 1, results: 3 }, 'SerpAPI google search request succeeded');
    });

    it("fetchTrending logs attempts, preview and success", async () => {
        const loggerInstance = createLogger();
        withContextMock.mockImplementationOnce(() => loggerInstance);
        getJson.mockImplementationOnce(async (params, callback) => {
            if (typeof callback === "function") {
                callback({ sample: true });
            }
            return {
                interest_over_time: { timeline_data: [{}, {}] },
            };
        });

        const { fetchTrending } = await import("../../src/data/serpapi.js");
        const res = await fetchTrending("trend");

        expect(fetchWithRetry).toHaveBeenCalledTimes(1);
        expect(res).toEqual({ interest_over_time: { timeline_data: [{}, {}] } });
        expect(loggerInstance.debug).toHaveBeenCalledWith({ attempt: 1 }, 'Requesting SerpAPI google_trends results');
        expect(loggerInstance.info).toHaveBeenCalledWith({ attempt: 1, preview: { sample: true } }, 'Received intermediate SerpAPI trends payload');
        expect(loggerInstance.info).toHaveBeenCalledWith({ attempt: 1, series: 2 }, 'SerpAPI google_trends request succeeded');
    });
});
