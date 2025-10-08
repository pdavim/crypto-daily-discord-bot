import { Agent, Task } from "kaibanjs";
import { z } from "zod";
import { buildPromptTemplates } from "../promptTemplates.js";
import { TECHNICAL_TASK_ID } from "./technical.js";
import { TRADER_TASK_ID } from "./trader.js";

export const RISK_TASK_ID = "risk";

export const riskOutputSchema = z.object({
    generatedAt: z.string(),
    portfolio: z.object({
        riskScore: z.number().min(0).max(1),
        summary: z.string(),
        cautions: z.array(z.string()).default([]),
    }),
    assets: z.array(z.object({
        asset: z.string(),
        maxPositionPct: z.number().min(0).max(1),
        stopLoss: z.string(),
        takeProfit: z.string(),
        riskNotes: z.array(z.string()).default([]),
    })),
    notes: z.string().optional(),
});

export function createRiskRole({ model, apiKey, maxIterations }) {
    const systemMessage = "You are the risk officer ensuring the trade plan aligns with portfolio constraints.";
    const initialMessage = "Assess proposed trades, recommend sizing, and highlight key risk mitigations.";
    const promptTemplates = buildPromptTemplates({ systemMessage, initialMessage });
    const agent = new Agent({
        name: "Risk Officer",
        role: "Stress test trade recommendations",
        goal: "Deliver risk scores, sizing guidance, and mitigation steps",
        background: "Risk manager experienced with crypto derivatives and portfolio construction",
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
        "Evaluate the trade plan and technical context to produce risk guidance.",
        `Trader output: {taskResult:${TRADER_TASK_ID}}`,
        `Technical highlights: {taskResult:${TECHNICAL_TASK_ID}}`,
        "Return JSON with generatedAt, portfolio (riskScore, summary, cautions), assets (maxPositionPct, stopLoss, takeProfit, riskNotes), and optional notes.",
    ].join("\n\n");

    const task = new Task({
        id: RISK_TASK_ID,
        title: "Risk review",
        description,
        expectedOutput: "Structured JSON containing portfolio and asset-level risk guidance.",
        agent,
        outputSchema: riskOutputSchema,
        dependencies: [TRADER_TASK_ID, TECHNICAL_TASK_ID],
        isDeliverable: false,
    });

    return { agent, task };
}
