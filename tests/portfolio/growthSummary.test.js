import path from "node:path";
import { describe, expect, it } from "vitest";

const { buildPortfolioGrowthDiscordMessage } = await import("../../src/portfolio/growthSummary.js");

describe("buildPortfolioGrowthDiscordMessage", () => {
    const baseSummary = {
        strategy: "Balanced",
        finalValue: 25000,
        investedCapital: 5000,
        contributionsTotal: 4000,
        contributionsCount: 40,
        targetCapital: 10_000_000,
        targetReached: false,
        metrics: {
            totalReturnPct: 4,
            cagr: 0.76,
            maxDrawdownPct: 0.28,
            annualizedVolatility: 0.52,
            sharpeRatio: 1.2,
            durationDays: 720,
        },
        progress: {
            pct: 0.0025,
            remainingCapital: 9_975_000,
            estimatedYearsToTarget: 8.4,
        },
        reports: {
            summaryPath: path.join(process.cwd(), "reports", "growth", "latest.json"),
            chartPath: path.join(process.cwd(), "charts", "growth", "portfolio_growth.png"),
        },
    };

    it("monta mensagem com métricas principais e links locais", () => {
        const payload = buildPortfolioGrowthDiscordMessage({
            summary: baseSummary,
            mention: "@here",
            locale: "pt-PT",
            includeReportLinks: true,
        });

        expect(payload.message).toContain("@here");
        expect(payload.message).toContain("Simulação 100€ → 10M€ · Balanced");
        expect(payload.message).toContain("Valor atual:");
        expect(payload.message).toContain("Meta:");
        expect(payload.message).toContain("Risco:");
        expect(payload.message).toContain("Relatórios salvos");
        expect(payload.attachments).toHaveLength(0);
    });

    it("omite relatórios quando includeReportLinks = false", () => {
        const payload = buildPortfolioGrowthDiscordMessage({
            summary: baseSummary,
            includeReportLinks: false,
        });

        expect(payload.message).not.toContain("Relatórios salvos");
    });

    it("retorna string vazia para resumo inválido", () => {
        const payload = buildPortfolioGrowthDiscordMessage({ summary: null });
        expect(payload).toEqual({ message: "", attachments: [] });
    });

    it("gera digest compacto e anexos quando há trades", () => {
        const trades = Array.from({ length: 12 }, (_, idx) => ({
            timestamp: new Date(2024, 0, idx + 1).toISOString(),
            asset: idx % 2 === 0 ? "BTC" : "ETH",
            action: idx % 3 === 0 ? "SELL" : "BUY",
            quantity: 0.1 + (idx * 0.01),
            price: 25_000 + (idx * 500),
            value: (0.1 + (idx * 0.01)) * (25_000 + (idx * 500)),
            reason: idx % 3 === 0 ? "rebalance" : "interval_rebalance",
        }));

        const payload = buildPortfolioGrowthDiscordMessage({
            summary: { ...baseSummary, trades, runAt: "2024-01-31T00:00:00.000Z" },
            locale: "pt-PT",
        });

        expect(payload.message).toContain("Trades (12 ordens)");
        expect(payload.message).toMatch(/BTC:/);
        expect(payload.message).toMatch(/ETH:/);
        expect(payload.message).toContain("Diário de trades anexado");
        expect(payload.attachments.length).toBeGreaterThan(0);
        const csvAttachment = payload.attachments.find((attachment) => attachment.contentType === "text/csv");
        expect(csvAttachment?.filename).toMatch(/portfolio-trades/);
        const csvPreview = csvAttachment ? csvAttachment.content.toString("utf8").split("\n").slice(0, 3) : [];
        expect(csvPreview[0]).toBe("timestamp,asset,side,quantity,price,notional,reason");
        expect(csvPreview[1]).toMatch(/BTC/);
        const jsonAttachment = payload.attachments.find((attachment) => attachment.contentType === "application/json");
        expect(jsonAttachment).toBeTruthy();
        const parsed = JSON.parse(jsonAttachment.content.toString("utf8"));
        expect(parsed[0]).toHaveProperty("asset");
    });
});
