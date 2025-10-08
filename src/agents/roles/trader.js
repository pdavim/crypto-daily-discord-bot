import { Agent, Task } from "kaibanjs";
import { z } from "zod";
import { buildPromptTemplates } from "../promptTemplates.js";
import { TECHNICAL_TASK_ID } from "./technical.js";
import { NEWS_TASK_ID } from "./news.js";
import { SENTIMENT_TASK_ID } from "./sentiment.js";
import { RESEARCH_TASK_ID } from "./research.js";

export const TRADER_TASK_ID = "trader";

export const traderOutputSchema = z.object({
    generatedAt: z.string(),
    assets: z.array(z.object({
        asset: z.string(),
        stance: z.enum(["long", "short", "flat"]),
        conviction: z.number().min(0).max(1),
        timeframe: z.string(),
        strategy: z.string(),
        entry: z.string().optional(),
        takeProfit: z.string().optional(),
        stopLoss: z.string().optional(),
        catalysts: z.array(z.string()).default([]),
        invalidations: z.array(z.string()).default([]),
        rationale: z.string(),
    })),
    notes: z.string().optional(),
});

export function createTraderRole({ model, apiKey, maxIterations }) {
    const systemMessage = "You are the trading lead turning insights into actionable positions.";
    const initialMessage = "Merge upstream analysis into clear trade plans with stance, conviction, strategy, and key levels.";
    const promptTemplates = buildPromptTemplates({ systemMessage, initialMessage });
    const agent = new Agent({
        name: "Trading Lead",
        role: "Propose actionable positions",
        goal: "Deliver trade ideas with stance, conviction, strategy, and levels",
        background: "Professional crypto trader skilled in risk-managed execution",
        llmConfig: {
            provider: "openrouter",
            model,
            apiKey,
        },
        maxIterations,
        forceFinalAnswer: true,
        promptTemplates,
    });

    const description = [
        "Combine upstream analysis into concrete trade recommendations.",
        `Technical insights: {taskResult:${TECHNICAL_TASK_ID}}`,
        `News intelligence: {taskResult:${NEWS_TASK_ID}}`,
        `Sentiment synthesis: {taskResult:${SENTIMENT_TASK_ID}}`,
        `Research theses: {taskResult:${RESEARCH_TASK_ID}}`,
        "Return JSON with generatedAt, assets, and optional notes.",
        "Each asset must include stance (long/short/flat), conviction (0-1), timeframe, strategy, entry/takeProfit/stopLoss (strings), catalysts, invalidations, and rationale.",
    ].join("\n\n");

    const task = new Task({
        id: TRADER_TASK_ID,
        title: "Trader synthesis",
        description,
        expectedOutput: "Structured JSON containing trade recommendations for each asset.",
        agent,
        outputSchema: traderOutputSchema,
        dependencies: [TECHNICAL_TASK_ID, NEWS_TASK_ID, SENTIMENT_TASK_ID, RESEARCH_TASK_ID],
        isDeliverable: false,
    });

    return { agent, task };
}
