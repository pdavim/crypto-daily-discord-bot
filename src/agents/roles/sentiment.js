import { Agent, Task } from "kaibanjs";
import { z } from "zod";
import { buildPromptTemplates } from "../promptTemplates.js";

export const SENTIMENT_TASK_ID = "sentiment";

export const sentimentOutputSchema = z.object({
    generatedAt: z.string(),
    assets: z.array(z.object({
        asset: z.string(),
        sentimentScore: z.number().min(-1).max(1),
        sentimentLabel: z.enum(["bullish", "bearish", "neutral"]),
        conviction: z.number().min(0).max(1),
        drivers: z.array(z.string()).default([]),
        commentary: z.string(),
    })),
    overallBias: z.enum(["bullish", "bearish", "neutral"]),
    confidence: z.number().min(0).max(1),
    notes: z.string().optional(),
});

export function createSentimentRole({ snapshot, model, apiKey, maxIterations }) {
    const systemMessage = "You are the sentiment strategist combining price action, news, and momentum.";
    const initialMessage = "Quantify market sentiment per asset, blending quantitative returns with qualitative news tone.";
    const promptTemplates = buildPromptTemplates({ systemMessage, initialMessage });
    const agent = new Agent({
        name: "Sentiment Strategist",
        role: "Score market sentiment and conviction",
        goal: "Deliver sentiment scores, labels, and supporting evidence",
        background: "Crypto analyst experienced with on-chain and market structure sentiment blends",
        llmConfig: {
            provider: "openrouter",
            model,
            apiKey,
        },
        maxIterations,
        forceFinalAnswer: true,
        promptTemplates,
    });

    const sentimentContext = snapshot.assets.map((asset) => {
        if (asset.status !== "ready") {
            return {
                asset: asset.key,
                status: asset.status,
                message: asset.message ?? "Unavailable",
            };
        }
        const { market, sentiment, news, technical } = asset.snapshot;
        return {
            asset: asset.key,
            status: asset.status,
            returns: market.returns,
            weightedSentiment: sentiment.weighted,
            newsSummary: news.summary,
            sparkline: technical.sparkline,
            heuristicScore: technical.heuristicScore,
        };
    });

    const description = [
        "Blend quantitative and qualitative inputs to score sentiment.",
        `Macro context: ${snapshot.macro || "n/a"}`,
        "Return JSON with generatedAt, assets, overallBias, confidence, and optional notes.",
        "Each asset must include sentimentScore (-1 to 1), sentimentLabel, conviction (0-1), commentary, and drivers.",
        "Sentiment dataset:",
        JSON.stringify(sentimentContext, null, 2),
    ].join("\n\n");

    const task = new Task({
        id: SENTIMENT_TASK_ID,
        title: "Sentiment scoring",
        description,
        expectedOutput: "Structured JSON capturing sentiment and conviction per asset.",
        agent,
        outputSchema: sentimentOutputSchema,
        isDeliverable: false,
    });

    return { agent, task };
}
