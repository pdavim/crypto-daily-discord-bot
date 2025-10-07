import OpenAi from "openai";
import { CFG } from "./config.js";
import { logger, withContext } from "./logger.js";
import { getEmbedding } from "./rag/embedding.js";
import { searchEmbeddings } from "./vectorStore.js";
import { callOpenRouter } from "./ai.js";

let openAiChatClient;

const resolveActiveModel = () => {
    const configured = typeof CFG?.rag?.activeModel === "string" ? CFG.rag.activeModel.trim() : "";
    if (configured !== "") {
        return configured;
    }
    throw new Error("CFG.rag.activeModel must be configured to answer questions with RAG.");
};

const isOpenRouterModel = (model) => model.toLowerCase().startsWith("openrouter/");

const resolveSearchLimit = () => {
    const configured = CFG?.rag?.searchLimit;
    const parsed = Number.isFinite(configured)
        ? configured
        : Number.parseInt(configured ?? "", 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
    }
    return 5;
};

const computeScore = (distance) => {
    const parsed = Number(distance);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return 0;
    }
    return 1 / (1 + parsed);
};

const isNonEmptyString = (value) => typeof value === "string" && value.trim() !== "";

const isLikelyHttpUrl = (value) => /^https?:\/\//i.test(value);

const extractMetadataDetails = (metadata) => {
    if (metadata == null) {
        return { summary: null, citationUrl: null, citationLabel: null };
    }
    let value = metadata;
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed === "") {
            return { summary: null, citationUrl: null, citationLabel: null };
        }
        try {
            value = JSON.parse(trimmed);
        } catch {
            const citationUrl = isLikelyHttpUrl(trimmed) ? trimmed : null;
            return {
                summary: trimmed,
                citationUrl,
                citationLabel: citationUrl ?? trimmed,
            };
        }
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return { summary: null, citationUrl: null, citationLabel: null };
    }
    const title = isNonEmptyString(value.title) ? value.title.trim() : null;
    const label = title
        ?? (isNonEmptyString(value.label) ? value.label.trim() : null)
        ?? null;
    const url = isNonEmptyString(value.url) ? value.url.trim() : null;
    const parts = [];
    if (title) {
        parts.push(title);
    }
    if (url) {
        parts.push(url);
    }
    if (!parts.length && isNonEmptyString(value.summary)) {
        parts.push(value.summary.trim());
    }
    return {
        summary: parts.length > 0 ? parts.join(" | ") : null,
        citationUrl: url,
        citationLabel: label ?? url ?? null,
    };
};

const selectTopMatches = (rows, limit) => {
    const matches = [];
    if (!Array.isArray(rows) || rows.length === 0) {
        return matches;
    }
    for (const row of rows) {
        if (matches.length >= limit) {
            break;
        }
        const content = typeof row?.content === "string" ? row.content.trim() : "";
        if (content === "") {
            continue;
        }
        const id = typeof row?.document_id === "string" && row.document_id.trim() !== ""
            ? row.document_id.trim()
            : typeof row?.id === "string" && row.id.trim() !== ""
                ? row.id.trim()
                : `doc-${matches.length + 1}`;
        const source = typeof row?.source === "string" && row.source.trim() !== ""
            ? row.source.trim()
            : "unknown";
        const score = computeScore(row?.distance);
        const chunkId = typeof row?.chunk_id === "string" && row.chunk_id.trim() !== ""
            ? row.chunk_id.trim()
            : null;
        const { summary, citationUrl, citationLabel } = extractMetadataDetails(row?.metadata);
        matches.push({
            id,
            source,
            score,
            content,
            chunkId,
            metadataSummary: summary,
            citationUrl,
            citationLabel,
        });
    }
    return matches;
};

const buildPrompt = (question, matches) => {
    const promptParts = [
        "Pergunta:",
        question,
    ];
    if (matches.length > 0) {
        const sourcesSection = matches.map((match, index) => {
            const header = [
                `[${index + 1}]`,
                match.source,
            ];
            if (match.chunkId) {
                header.push(`chunk ${match.chunkId}`);
            }
            if (match.metadataSummary) {
                header.push(match.metadataSummary);
            }
            header.push(`score ${match.score.toFixed(3)}`);
            return `${header.join(" | ")}\n${match.content}`;
        }).join("\n\n");
        promptParts.push("Fontes numeradas:");
        promptParts.push(sourcesSection);
    } else {
        promptParts.push("Fontes numeradas:");
        promptParts.push("Nenhum trecho relevante foi encontrado nos documentos disponíveis.");
    }
    promptParts.push("Instruções:");
    promptParts.push(
        "Responda em português utilizando apenas as informações das fontes. Cite-as no formato [n] e explique quando as evidências não forem suficientes.",
    );
    return promptParts.join("\n\n");
};

const resolveOpenAiApiKey = () => {
    const cfgKey = typeof CFG?.openaiApiKey === "string" ? CFG.openaiApiKey.trim() : "";
    if (cfgKey !== "") {
        return cfgKey;
    }
    const envKey = typeof process.env.OPENAI_API_KEY === "string" ? process.env.OPENAI_API_KEY.trim() : "";
    if (envKey !== "") {
        return envKey;
    }
    throw new Error("OpenAI API key missing for the configured RAG model.");
};

const getOpenAiChatClient = () => {
    if (openAiChatClient) {
        return openAiChatClient;
    }
    const apiKey = resolveOpenAiApiKey();
    openAiChatClient = new OpenAi({ apiKey });
    return openAiChatClient;
};

const buildMessages = (question, matches) => {
    const prompt = buildPrompt(question, matches);
    return [
        {
            role: "system",
            content: "Você é um analista que responde perguntas sobre o projeto usando apenas as fontes fornecidas. Sempre cite as fontes no formato [n].",
        },
        {
            role: "user",
            content: [
                {
                    type: "text",
                    text: prompt,
                },
            ],
        },
    ];
};

/**
 * Answers a question using retrieval-augmented generation.
 * @param {string} question - Question provided by the user.
 * @returns {Promise<{ answer: string, sources: Array<{ id: string, score: number, source: string }> }>} Answer and supporting sources.
 */
export const answerWithRAG = async (question) => {
    const normalizedQuestion = typeof question === "string" ? question.trim() : "";
    if (normalizedQuestion === "") {
        throw new Error("Question must be a non-empty string.");
    }
    const log = withContext(logger, { fn: "answerWithRAG" });
    const model = resolveActiveModel();
    const limit = resolveSearchLimit();
    try {
        const embedding = await getEmbedding(normalizedQuestion);
        const rows = await searchEmbeddings({ embedding, limit });
        const matches = selectTopMatches(rows, limit);
        const messages = buildMessages(normalizedQuestion, matches);
        let completion;
        if (isOpenRouterModel(model)) {
            completion = await callOpenRouter(messages, { model });
        } else {
            const client = getOpenAiChatClient();
            const response = await client.chat.completions.create({
                model,
                messages,
            });
            completion = response?.choices?.[0]?.message?.content ?? "";
        }
        const answer = typeof completion === "string" ? completion.trim() : "";
        return {
            answer,
            sources: matches.map((match) => ({
                id: match.id,
                score: match.score,
                source: match.source,
                citationUrl: match.citationUrl ?? null,
                citationLabel: match.citationLabel ?? null,
            })),
        };
    } catch (error) {
        log.error({ err: error }, 'Failed to answer question with RAG');
        throw error;
    }
};

export const resetRagClients = () => {
    openAiChatClient = undefined;
};

