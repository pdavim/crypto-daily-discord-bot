import { Agent, Task } from "kaibanjs";
import { z } from "zod";
import { buildPromptTemplates } from "../promptTemplates.js";

export const RESEARCH_TASK_ID = "research";

export const researchOutputSchema = z.object({
    generatedAt: z.string(),
    assets: z.array(z.object({
        asset: z.string(),
        thesis: z.string(),
        opportunities: z.array(z.string()).default([]),
        risks: z.array(z.string()).default([]),
        sources: z.array(z.string()).default([]),
    })),
    marketThemes: z.array(z.string()).default([]),
});

export function createResearchRole({ snapshot, model, apiKey, maxIterations }) {
    const systemMessage = "You are the research lead distilling external intelligence and web context.";
    const initialMessage = "Transform the provided search intelligence into actionable theses and supporting sources.";
    const promptTemplates = buildPromptTemplates({ systemMessage, initialMessage });
    const agent = new Agent({
        name: "Research Analyst",
        role: "Synthesize web intelligence and thematic context",
        goal: "Produce concise theses, opportunities, risks, and source references",
        background: "Macro researcher with experience in crypto adoption and ecosystem analysis",
        llmConfig: {
            provider: "openrouter",
            model,
            apiKey,
        },
        maxIterations,
        forceFinalAnswer: true,
        promptTemplates,
    });

    const researchContext = snapshot.assets.map((asset) => {
        if (asset.status !== "ready") {
            return {
                asset: asset.key,
                status: asset.status,
                message: asset.message ?? "Unavailable",
            };
        }
        const { research, news } = asset.snapshot;
        return {
            asset: asset.key,
            status: asset.status,
            newsSummary: news.summary,
            snippets: research.snippets,
        };
    });

    const description = [
        "Convert external research snippets into investable theses.",
        `Macro context: ${snapshot.macro || "n/a"}`,
        "Return JSON with generatedAt, assets, and marketThemes.",
        "Each asset must include thesis, opportunities (array), risks (array), and sources (array of URLs or titles).",
        "Research dataset:",
        JSON.stringify(researchContext, null, 2),
    ].join("\n\n");

    const task = new Task({
        id: RESEARCH_TASK_ID,
        title: "Research synthesis",
        description,
        expectedOutput: "Structured JSON containing thesis, opportunities, risks, and sources for each asset.",
        agent,
        outputSchema: researchOutputSchema,
        isDeliverable: false,
    });

    return { agent, task };
}
