import OpenAi from "openai";
import { CFG } from "../config.js";
import { logger, withContext } from "../logger.js";

let embeddingClient;

const resolveApiKey = () => {
    const cfgKey = typeof CFG?.openaiApiKey === "string" && CFG.openaiApiKey.trim() !== ""
        ? CFG.openaiApiKey.trim()
        : null;
    if (cfgKey) {
        return cfgKey;
    }
    const envKey = typeof process.env.OPENAI_API_KEY === "string" && process.env.OPENAI_API_KEY.trim() !== ""
        ? process.env.OPENAI_API_KEY.trim()
        : null;
    return envKey;
};

const getClient = () => {
    if (embeddingClient) {
        return embeddingClient;
    }
    const apiKey = resolveApiKey();
    if (!apiKey) {
        throw new Error("OpenAI API key is not configured.");
    }
    embeddingClient = new OpenAi({ apiKey });
    return embeddingClient;
};

const normalizeEmbeddingVector = (embedding) => {
    if (!Array.isArray(embedding)) {
        throw new TypeError("OpenAI embedding response is missing the embedding vector.");
    }
    const vector = embedding.map((value) => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
            throw new TypeError("Embedding vector contains non-finite values.");
        }
        return parsed;
    });
    if (vector.length === 0) {
        throw new Error("Embedding vector must not be empty.");
    }
    return vector;
};

const resolveModel = (model) => {
    const requested = typeof model === "string" && model.trim() !== ""
        ? model.trim()
        : null;
    if (requested) {
        return requested;
    }
    const cfgModel = typeof CFG?.rag?.embeddingModel === "string" && CFG.rag.embeddingModel.trim() !== ""
        ? CFG.rag.embeddingModel.trim()
        : null;
    if (cfgModel) {
        return cfgModel;
    }
    return "text-embedding-3-large";
};

/**
 * Requests an embedding vector for the provided text using OpenAI.
 * @param {string} text - Text content to embed.
 * @param {{ model?: string }} [options={}] - Optional overrides for the embedding model.
 * @returns {Promise<number[]>} Numeric embedding vector returned by OpenAI.
 */
export const getEmbedding = async (text, options = {}) => {
    const normalized = typeof text === "string" ? text.trim() : "";
    if (normalized === "") {
        throw new Error("Cannot generate embeddings for empty text.");
    }
    const log = withContext(logger, { fn: "rag.getEmbedding" });
    try {
        const client = getClient();
        const model = resolveModel(options?.model);
        const response = await client.embeddings.create({
            model,
            input: normalized,
        });
        const vector = response?.data?.[0]?.embedding;
        return normalizeEmbeddingVector(vector);
    } catch (error) {
        log.error({ err: error }, "Failed to generate embedding");
        throw error;
    }
};

/**
 * Allows tests to replace the OpenAI client with a stub implementation.
 * @param {*} client - Client instance implementing the embeddings API.
 */
export const setEmbeddingClient = (client) => {
    embeddingClient = client;
};

/**
 * Clears the cached OpenAI client, forcing reinitialization on the next request.
 */
export const resetEmbeddingClient = () => {
    embeddingClient = undefined;
};

