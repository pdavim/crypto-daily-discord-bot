import { Buffer } from "node:buffer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchDailyClosesMock = vi.fn();
const renderPortfolioGrowthChartMock = vi.fn();

vi.mock("../../src/data/marketData.js", () => ({
    fetchDailyCloses: fetchDailyClosesMock,
}));

vi.mock("../../src/chart.js", async () => {
    const actual = await vi.importActual("../../src/chart.js");
    return {
        ...actual,
        renderPortfolioGrowthChart: renderPortfolioGrowthChartMock,
    };
});

const { CFG } = await import("../../src/config.js");
const { runPortfolioGrowthSimulation } = await import("../../src/portfolio/growth.js");

const buildSeries = (startPrice, step) => {
    const start = Date.UTC(2024, 0, 1);
    return Array.from({ length: 40 }, (_, idx) => ({
        t: new Date(start + idx * 24 * 60 * 60 * 1000),
        c: startPrice + (idx * step),
    }));
};

describe("portfolio growth simulation", () => {
    let tmpRoot;

    beforeEach(() => {
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "portfolio-growth-"));
        fetchDailyClosesMock.mockReset();
        renderPortfolioGrowthChartMock.mockReset();
        renderPortfolioGrowthChartMock.mockResolvedValue(path.join(tmpRoot, "charts", "portfolio_growth.png"));
        CFG.portfolioGrowth = {
            enabled: true,
            initialCapital: 100,
            targetCapital: 5_000,
            simulation: {
                historyDays: 60,
                riskFreeRate: 0.02,
                contribution: { amount: 20, intervalDays: 7 },
                slippagePct: 0.001,
            },
            rebalance: { intervalDays: 7, tolerancePct: 0.02 },
            risk: {
                maxDrawdownPct: 0.6,
                stopLossPct: 0.25,
                takeProfitPct: 0.4,
                maxPositionPct: 0.7,
                volatilityLookback: 10,
                volatilityTargetPct: 0.12,
            },
            reporting: {
                enabled: true,
                directory: path.join(tmpRoot, "reports"),
                chartDirectory: path.join(tmpRoot, "charts"),
                appendToUploads: true,
            },
            discord: {
                enabled: true,
                mention: "@here",
                webhookUrl: "",
                channelId: "",
                locale: "pt-PT",
                includeReportLinks: true,
            },
            strategies: {
                default: {
                    name: "Balanced",
                    allocation: { BTC: 0.6, ETH: 0.4 },
                    minAllocationPct: 0,
                    maxAllocationPct: 0.7,
                },
            },
        };
        fetchDailyClosesMock.mockImplementation(async (asset) => {
            const symbol = asset?.symbol ?? asset?.symbols?.market ?? asset?.key ?? "";
            if (symbol.startsWith("BTC")) {
                return buildSeries(20_000, 150);
            }
            if (symbol.startsWith("ETH")) {
                return buildSeries(1_000, 10);
            }
            return buildSeries(100, 1);
        });
    });

    afterEach(() => {
        fetchDailyClosesMock.mockReset();
        renderPortfolioGrowthChartMock.mockReset();
        if (tmpRoot && fs.existsSync(tmpRoot)) {
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        }
    });

    it("simula o crescimento do portfólio e salva relatórios", async () => {
        const assets = [
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

        const result = await runPortfolioGrowthSimulation({ assets });

        expect(result).not.toBeNull();
        expect(result?.history?.length).toBeGreaterThan(10);
        expect(result?.metrics?.rebalances).toBeGreaterThan(0);
        expect(result?.reports?.summaryPath).toBeTruthy();
        expect(fs.existsSync(result?.reports?.summaryPath ?? "")).toBe(true);
        expect(fs.existsSync(result?.reports?.progressionPath ?? "")).toBe(true);
        expect(renderPortfolioGrowthChartMock).toHaveBeenCalledOnce();
        expect(result?.uploads).toHaveLength(1);
        expect(result?.progress?.pct).toBeGreaterThan(0);
        expect(result?.discord?.message).toContain("Simulação 100€ → 10M€");
        expect(result?.discordMessage).toBe(result?.discord?.message);
        expect(Array.isArray(result?.trades)).toBe(true);
        expect(result.trades.length).toBeGreaterThan(0);
        const sampleTrade = result.trades[0];
        expect(sampleTrade).toMatchObject({
            asset: expect.any(String),
            action: expect.any(String),
            quantity: expect.any(Number),
            price: expect.any(Number),
            reason: expect.any(String),
        });
        expect(sampleTrade).toHaveProperty("timestamp");
        expect(sampleTrade).toHaveProperty("value");
        expect(Array.isArray(result.discord.attachments)).toBe(true);
        expect(result.discord.attachments.length).toBeGreaterThan(0);
        expect(result.discord.attachments[0].content).toBeInstanceOf(Buffer);
        const persisted = JSON.parse(fs.readFileSync(result.reports.summaryPath, "utf8"));
        expect(Array.isArray(persisted.trades)).toBe(true);
        expect(persisted.discord.attachments[0]).toMatchObject({
            filename: expect.any(String),
            contentType: expect.any(String),
            size: expect.any(Number),
        });
        expect(persisted.discord.attachments[0]).not.toHaveProperty("content");
    });

    it("retorna null quando o módulo está desativado", async () => {
        CFG.portfolioGrowth.enabled = false;
        const outcome = await runPortfolioGrowthSimulation({
            assets: [{
                key: "BTC",
                exchange: "binance",
                symbol: "BTCUSDT",
                symbols: { market: "BTCUSDT" },
                capabilities: { candles: true, daily: true },
            }],
        });
        expect(outcome).toBeNull();
        expect(fetchDailyClosesMock).not.toHaveBeenCalled();
    });
});

