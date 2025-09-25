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
        const message = buildPortfolioGrowthDiscordMessage({
            summary: baseSummary,
            mention: "@here",
            locale: "pt-PT",
            includeReportLinks: true,
        });

        expect(message).toContain("@here");
        expect(message).toContain("Simulação 100€ → 10M€ · Balanced");
        expect(message).toContain("Valor atual:");
        expect(message).toContain("Meta:");
        expect(message).toContain("Risco:");
        expect(message).toContain("Relatórios salvos");
    });

    it("omite relatórios quando includeReportLinks = false", () => {
        const message = buildPortfolioGrowthDiscordMessage({
            summary: baseSummary,
            includeReportLinks: false,
        });

        expect(message).not.toContain("Relatórios salvos");
    });

    it("retorna string vazia para resumo inválido", () => {
        const message = buildPortfolioGrowthDiscordMessage({ summary: null });
        expect(message).toBe("");
    });
});
