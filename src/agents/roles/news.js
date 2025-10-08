import { Agent, Task } from "kaibanjs";
import { z } from "zod";
import { buildPromptTemplates } from "../promptTemplates.js";

export const NEWS_TASK_ID = "news";

export const newsOutputSchema = z.object({
    generatedAt: z.string(),
    assets: z.array(z.object({
        asset: z.string(),
        headlineSummary: z.string(),
        catalysts: z.array(z.string()).default([]),
        sentimentScore: z.number().min(-1).max(1),
        sentimentLabel: z.enum(["positive", "neutral", "negative"]),
        riskWarnings: z.array(z.string()).default([]),
    })),
    macro: z.string().optional(),
    notableEvents: z.array(z.string()).default([]),
});

export function createNewsRole({ snapshot, model, apiKey, maxIterations }) {
    const systemMessage = "You lead the news desk covering digital assets. Extract catalysts and risks.";
    const initialMessage = "Summarise relevant news across the tracked assets. Focus on catalysts, risks, and sentiment.";
    const promptTemplates = buildPromptTemplates({ systemMessage, initialMessage });
    const agent = new Agent({
        name: "News Analyst",
        role: "Digest crypto headlines and macro narratives",
        goal: "Provide concise catalysts, risks, and sentiment for each asset",
        background: "Financial journalist specialising in digital assets and macro policy",
        llmConfig: {
            provider: "openrouter",
            model,
            apiKey,
        },
        maxIterations,
        forceFinalAnswer: true,
        promptTemplates,
    });

    const newsContext = snapshot.assets.map((asset) => {
        if (asset.status !== "ready") {
            return {
                asset: asset.key,
                status: asset.status,
                message: asset.message ?? "Unavailable",
            };
        }
        const { news, sentiment } = asset.snapshot;
        return {
            asset: asset.key,
            status: asset.status,
            summary: news.summary,
            weightedSentiment: sentiment.weighted,
            snippets: news.snippets,
            returns: asset.snapshot.market.returns,
        };
    });

    const description = [
        "Aggregate news drivers and sentiment for each asset.",
        `Macro context: ${snapshot.macro || "n/a"}`,
        "Return JSON with generatedAt, assets, macro, and notableEvents.",
        "Each asset must include headlineSummary, catalysts, sentimentScore (-1 to 1), sentimentLabel, and riskWarnings.",
        "News dataset:",
        JSON.stringify(newsContext, null, 2),
    ].join("\n\n");

    const task = new Task({
        id: NEWS_TASK_ID,
        title: "News intelligence sweep",
        description,
        expectedOutput: "Structured JSON summarising news catalysts and risks per asset.",
        agent,
        outputSchema: newsOutputSchema,
        isDeliverable: false,
    });

    return { agent, task };
}
