import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const sendDiscordAlertMock = vi.fn();
const recordNewsDigestMock = vi.fn();
const getAssetNewsMock = vi.fn();

const baseLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

vi.mock("../../src/assets.js", () => ({
    ASSETS: [
        { key: "BTC" },
        { key: "ETH" },
    ],
}));

vi.mock("../../src/news.js", () => ({
    getAssetNews: getAssetNewsMock,
}));

vi.mock("../../src/discord.js", () => ({
    postNewsDigest: vi.fn(({ content, webhookUrl, channelId }) => sendDiscordAlertMock(content, { webhookUrl, channelId })),
    sendDiscordAlert: sendDiscordAlertMock,
}));

vi.mock("../../src/controllers/sheetsReporter.js", () => ({
    recordNewsDigest: recordNewsDigestMock,
}));

vi.mock("../../src/logger.js", () => ({
    logger: baseLogger,
    withContext: vi.fn(() => baseLogger),
}));

const assetDefinitions = [
    {
        key: "BTC",
        exchange: "binance",
        symbol: "BTCUSDT",
        symbols: { market: "BTCUSDT" },
        capabilities: { candles: true, daily: true },
    },
    {
        key: "ETH",
        exchange: "binance",
        symbol: "ETHUSDT",
        symbols: { market: "ETHUSDT" },
        capabilities: { candles: true, daily: true },
    },
];

vi.mock("../../src/config.js", () => ({
    CFG: {
        assets: assetDefinitions,
        assetMap: new Map(assetDefinitions.map(asset => [asset.key, asset])),
        newsDigest: {
            enabled: true,
            cron: "0 9 * * *",
            webhookUrl: "https://discord.test/webhooks/abc/123",
            channelId: "channel-xyz",
            sheetMapKey: "newsDigest",
            sheetFallback: "news_digest",
        },
        googleSheets: { enabled: true },
    },
}));

describe("newsDigest controller", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.resetModules();
    });

    it("builds a digest message with sentiment labels and links", async () => {
        getAssetNewsMock.mockImplementation(async ({ symbol }) => {
            if (symbol === "BTC") {
                return {
                    summary: "Bitcoin rallies as institutions accumulate.",
                    weightedSentiment: 0.42,
                    avgSentiment: 0.35,
                    items: [
                        {
                            title: "BTC jumps to new monthly high",
                            url: "https://news.example/btc-high",
                            source: "CoinDesk",
                            sentiment: 0.6,
                        },
                        {
                            title: "Institutional inflows surge",
                            url: "https://news.example/btc-inflows",
                            source: "Bloomberg",
                            sentiment: 0.2,
                        },
                    ],
                };
            }
            return {
                summary: "",
                weightedSentiment: -0.37,
                avgSentiment: -0.15,
                items: [
                    {
                        title: "ETH faces selling pressure",
                        url: "https://news.example/eth-selling",
                        source: "The Block",
                        sentiment: -0.5,
                    },
                ],
            };
        });

        const { buildNewsDigest } = await import("../../src/controllers/newsDigest.js");
        const digest = await buildNewsDigest();

        expect(digest.content).toContain("**🗞️ Daily Crypto News Digest**");
        expect(digest.content).toContain("**BTC** — Bullish (0.42)");
        expect(digest.content).toContain("[BTC jumps to new monthly high](https://news.example/btc-high)");
        expect(digest.content).toContain("Bullish (0.60)");
        expect(digest.content).toContain("**ETH** — Bearish (-0.37)");
        expect(digest.content).toContain("_ETH: ETH faces selling pressure_");
        expect(digest.content).toContain("Bearish (-0.50)");
        expect(digest.topHeadlines).toHaveLength(2);
        expect(digest.topHeadlines[0]).toMatchObject({ asset: "BTC", title: "BTC jumps to new monthly high" });
        expect(digest.sentiments).toEqual([
            expect.objectContaining({ asset: "BTC", weightedSentiment: 0.42, avgSentiment: 0.35 }),
            expect.objectContaining({ asset: "ETH", weightedSentiment: -0.37, avgSentiment: -0.15 }),
        ]);
    });

    it("delivers and records the digest payload", async () => {
        getAssetNewsMock.mockResolvedValue({
            summary: "Market stays range-bound.",
            weightedSentiment: 0.1,
            avgSentiment: 0.05,
            items: [
                {
                    title: "Consolidation continues",
                    url: "https://news.example/consolidation",
                    source: "Cointelegraph",
                    sentiment: 0.1,
                },
            ],
        });
        sendDiscordAlertMock.mockResolvedValue({
            delivered: true,
            webhookUrl: "https://discord.test/webhooks/abc/123",
            channelId: "channel-xyz",
        });

        const { dispatchNewsDigest } = await import("../../src/controllers/newsDigest.js");
        const result = await dispatchNewsDigest();

        expect(sendDiscordAlertMock).toHaveBeenCalledTimes(1);
        expect(sendDiscordAlertMock.mock.calls[0][0]).toContain("Daily Crypto News Digest");
        expect(sendDiscordAlertMock.mock.calls[0][1]).toMatchObject({
            webhookUrl: "https://discord.test/webhooks/abc/123",
            channelId: "channel-xyz",
        });
        expect(recordNewsDigestMock).toHaveBeenCalledTimes(1);
        expect(recordNewsDigestMock.mock.calls[0][0]).toMatchObject({
            summary: expect.stringContaining("Market stays range-bound."),
            webhookKey: "newsDigest",
            channelId: "channel-xyz",
        });
        expect(recordNewsDigestMock.mock.calls[0][0].topHeadlines[0]).toMatchObject({
            asset: "BTC",
            title: "Consolidation continues",
        });
        expect(result.delivery).toMatchObject({ delivered: true, channelId: "channel-xyz" });
    });
});
