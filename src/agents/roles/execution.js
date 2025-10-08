import { Agent, Task } from "kaibanjs";
import { z } from "zod";
import { buildPromptTemplates } from "../promptTemplates.js";
import { TECHNICAL_TASK_ID } from "./technical.js";
import { NEWS_TASK_ID } from "./news.js";
import { SENTIMENT_TASK_ID } from "./sentiment.js";
import { RESEARCH_TASK_ID } from "./research.js";
import { TRADER_TASK_ID } from "./trader.js";
import { RISK_TASK_ID } from "./risk.js";

export const EXECUTION_TASK_ID = "execution";

export const executionOutputSchema = z.object({
    generatedAt: z.string(),
    report: z.string(),
    macro: z.string().optional(),
    summary: z.string().optional(),
    decisions: z.array(z.object({
        asset: z.string(),
        stance: z.enum(["long", "short", "flat"]),
        confidence: z.number().min(0).max(1),
        timeframe: z.string(),
        entry: z.string().optional(),
        takeProfit: z.string().optional(),
        stopLoss: z.string().optional(),
        positionSize: z.number().min(0).max(1).optional(),
        rationale: z.string(),
        riskNotes: z.array(z.string()).default([]),
    })),
    callToAction: z.string().optional(),
    notes: z.string().optional(),
});

export function createExecutionRole({ snapshot, model, apiKey, maxIterations }) {
    const systemMessage = "You coordinate execution, producing the final decision package for distribution.";
    const initialMessage = "Synthesize upstream outputs into a final trading brief with a Markdown report and structured decisions.";
    const promptTemplates = buildPromptTemplates({ systemMessage, initialMessage });
    const agent = new Agent({
        name: "Execution Coordinator",
        role: "Publish final trading decision",
        goal: "Deliver a Markdown report plus structured decision payload",
        background: "Operations lead experienced with trading communication",
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
        "Produce the final decision pack using upstream outputs.",
        `Technical intelligence: {taskResult:${TECHNICAL_TASK_ID}}`,
        `News briefing: {taskResult:${NEWS_TASK_ID}}`,
        `Sentiment desk: {taskResult:${SENTIMENT_TASK_ID}}`,
        `Research briefing: {taskResult:${RESEARCH_TASK_ID}}`,
        `Trader plan: {taskResult:${TRADER_TASK_ID}}`,
        `Risk review: {taskResult:${RISK_TASK_ID}}`,
        `Macro context baseline: ${snapshot.macro || "n/a"}`,
        "Return JSON with generatedAt, report (Markdown), macro, summary, decisions, callToAction, and notes.",
        "The Markdown report should mirror the legacy Discord output structure with sections per asset, macro, and disclaimer.",
    ].join("\n\n");

    const task = new Task({
        id: EXECUTION_TASK_ID,
        title: "Execution packaging",
        description,
        expectedOutput: "Structured JSON containing the final Markdown report and decision metadata.",
        agent,
        outputSchema: executionOutputSchema,
        dependencies: [TRADER_TASK_ID, RISK_TASK_ID, TECHNICAL_TASK_ID, NEWS_TASK_ID, SENTIMENT_TASK_ID, RESEARCH_TASK_ID],
        isDeliverable: true,
    });

    return { agent, task };
}
