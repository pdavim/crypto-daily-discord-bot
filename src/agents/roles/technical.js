import { Agent, Task } from "kaibanjs";
import { z } from "zod";
import { buildPromptTemplates } from "../promptTemplates.js";

export const TECHNICAL_TASK_ID = "technical";

export const technicalOutputSchema = z.object({
    generatedAt: z.string(),
    assets: z.array(z.object({
        asset: z.string(),
        horizon: z.string(),
        bias: z.enum(["bullish", "bearish", "neutral"]),
        confidence: z.number().min(0).max(1),
        summary: z.string(),
        indicators: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
        signals: z.array(z.string()).default([]),
        riskFlags: z.array(z.string()).default([]),
    })),
    notes: z.string().optional(),
});

export function createTechnicalRole({ snapshot, model, apiKey, maxIterations }) {
    const systemMessage = "You are the lead technical strategist for a crypto trading desk.";
    const initialMessage = "Review the provided indicator snapshot and produce structured JSON summarising the trend, momentum, and volatility picture for each asset.";
    const promptTemplates = buildPromptTemplates({ systemMessage, initialMessage });
    const agent = new Agent({
        name: "Technical Strategist",
        role: "Analyse technical indicators and price structure",
        goal: "Summarise technical positioning and actionable signals",
        background: "Expert in quantitative crypto trading and volatility modelling",
        llmConfig: {
            provider: "openrouter",
            model,
            apiKey,
        },
        maxIterations,
        forceFinalAnswer: true,
        promptTemplates,
    });

    const technicalContext = snapshot.assets.map((asset) => {
        if (asset.status !== "ready") {
            return {
                asset: asset.key,
                status: asset.status,
                message: asset.message ?? "Unavailable",
            };
        }
        const { market, technical, heuristics } = asset.snapshot;
        return {
            asset: asset.key,
            status: asset.status,
            price: market.lastDaily?.c ?? null,
            returns: market.returns,
            indicators: {
                ma20: technical.ma20,
                ma50: technical.ma50,
                ma200: technical.ma200,
                rsi14: technical.rsi14,
                macdLine: technical.macdLine,
                macdSignal: technical.macdSignal,
                macdHistogram: technical.macdHistogram,
                bollingerWidth: technical.bollingerWidth,
                bollingerSqueeze: technical.bollingerSqueeze,
                atr14: technical.atr,
                parabolicSar: technical.sar,
                volumeDivergence: technical.volume,
                trend: technical.trend,
                vwap: technical.vwap,
                ema9: technical.ema9,
                ema21: technical.ema21,
                stochasticK: technical.stochasticK,
                stochasticD: technical.stochasticD,
                williamsR: technical.williamsR,
                cci: technical.cci,
                obv: technical.obv,
            },
            heuristicScore: heuristics.score,
            semaforo: heuristics.semaforo,
            fallbackVerdict: heuristics.fallbackVerdict,
            sparkline: technical.sparkline,
        };
    });

    const description = [
        "Evaluate the intraday technical posture for each asset.",
        `Macro context: ${snapshot.macro || "n/a"}`,
        "Return a JSON object with \"generatedAt\", \"assets\", and optional \"notes\" fields.",
        "Each asset entry must include bias (bullish/bearish/neutral), confidence (0-1), summary, indicators, signals, and risk flags.",
        "Indicator snapshot:",
        JSON.stringify(technicalContext, null, 2),
    ].join("\n\n");

    const task = new Task({
        id: TECHNICAL_TASK_ID,
        title: "Technical analysis sweep",
        description,
        expectedOutput: "Structured JSON describing technical trends for every asset.",
        agent,
        outputSchema: technicalOutputSchema,
        isDeliverable: false,
    });

    return { agent, task };
}
