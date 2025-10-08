import { beforeEach, describe, expect, it, vi } from "vitest";

const sendDiscordAlertMock = vi.fn();
const recordTradingEventMock = vi.fn();
const loggerMocks = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

vi.mock("../../src/discord.js", () => ({
    sendDiscordAlert: sendDiscordAlertMock,
}));

vi.mock("../../src/controllers/sheetsReporter.js", () => ({
    recordTradingEvent: recordTradingEventMock,
}));

vi.mock("../../src/logger.js", () => ({
    logger: loggerMocks,
    withContext: () => loggerMocks,
}));

const { CFG } = await import("../../src/config.js");
const { reportTradingDecision, reportTradingExecution } = await import("../../src/trading/notifier.js");

describe("trading notifier", () => {
    beforeEach(() => {
        sendDiscordAlertMock.mockReset();
        recordTradingEventMock.mockReset();
        Object.values(loggerMocks).forEach(mock => mock.mockReset());
        CFG.trading = {
            discord: { enabled: false, webhookUrl: null, channelId: null, mention: "" },
            logging: { sheetKey: "trading_actions" },
        };
    });

    it("records sheet events even when Discord delivery is disabled", async () => {
        CFG.trading.logging.sheetKey = "custom_sheet";

        await reportTradingDecision({
            assetKey: "BTC",
            symbol: "BTCUSDT",
            timeframe: "4h",
            status: "skipped",
            reason: "maxPositions",
        });

        expect(sendDiscordAlertMock).not.toHaveBeenCalled();
        expect(recordTradingEventMock).toHaveBeenCalledTimes(1);
        const payload = recordTradingEventMock.mock.calls[0][0];
        expect(payload).toMatchObject({
            messageType: "trading_decision",
            webhookKey: "custom_sheet",
            asset: "BTC",
        });
        expect(payload.metadata).toMatchObject({ status: "skipped", reason: "maxPositions" });
        expect(payload.metadata.complianceStatus).toBeUndefined();
    });

    it("sends Discord alerts with mentions when configured", async () => {
        CFG.trading.discord = {
            enabled: true,
            webhookUrl: "https://discord.com/api/webhooks/abc/def",
            channelId: "123",
            mention: "@here",
        };

        sendDiscordAlertMock.mockResolvedValue({ delivered: true, webhookUrl: CFG.trading.discord.webhookUrl, channelId: "123" });

        await reportTradingExecution({
            assetKey: "ETH",
            symbol: "ETHUSDT",
            action: "open",
            status: "executed",
            side: "BUY",
            quantity: 0.5,
            price: 1800,
            notional: 900,
            orderId: 1,
        });

        expect(sendDiscordAlertMock).toHaveBeenCalledTimes(1);
        const [content, options] = sendDiscordAlertMock.mock.calls[0];
        expect(content.startsWith("@here")).toBe(true);
        expect(options).toMatchObject({ webhookUrl: CFG.trading.discord.webhookUrl, channelId: "123" });

        expect(recordTradingEventMock).toHaveBeenCalledTimes(1);
        const sheetPayload = recordTradingEventMock.mock.calls[0][0];
        expect(sheetPayload.content.startsWith("@here")).toBe(true);
        expect(sheetPayload.metadata).toMatchObject({
            status: "executed",
            action: "open",
            side: "BUY",
            quantity: 0.5,
            price: 1800,
            notional: 900,
            orderId: 1,
        });
    });

    it("annotates compliance breaches in notifications", async () => {
        await reportTradingExecution({
            assetKey: "SOL",
            symbol: "SOLUSDT",
            action: "open",
            status: "skipped",
            side: "BUY",
            reason: "risk:maxExposure",
            metadata: {
                compliance: {
                    status: "blocked",
                    breaches: [{ type: "maxExposure", message: "limit" }],
                    messages: ["Exposure limit"]
                }
            }
        });

        expect(recordTradingEventMock).toHaveBeenCalledTimes(1);
        const payload = recordTradingEventMock.mock.calls[0][0];
        expect(payload.content).toContain("Risk blocked");
        expect(payload.metadata).toMatchObject({
            complianceStatus: "blocked",
        });
        expect(payload.metadata.complianceBreaches).toContain("maxExposure");
    });
});
