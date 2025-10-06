import { CFG } from "../config.js";

const MIN_CHUNK_SIZE = 200;
const MAX_CHUNK_SIZE = 800;

const toPositiveInt = (value) => {
    const parsed = Number.isFinite(value) ? value : Number.parseInt(value ?? "", 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return null;
    }
    return Math.floor(parsed);
};

const clampChunkSize = (size) => {
    const normalized = toPositiveInt(size);
    if (normalized === null) {
        return null;
    }
    if (normalized < MIN_CHUNK_SIZE) {
        return MIN_CHUNK_SIZE;
    }
    if (normalized > MAX_CHUNK_SIZE) {
        return MAX_CHUNK_SIZE;
    }
    return normalized;
};

const resolveChunkSize = (size) => {
    const requested = clampChunkSize(size);
    if (requested !== null) {
        return requested;
    }
    const cfgSize = clampChunkSize(CFG?.rag?.chunkSize);
    if (cfgSize !== null) {
        return cfgSize;
    }
    return MAX_CHUNK_SIZE;
};

const resolveChunkOverlap = (overlap, chunkSize) => {
    const normalized = toPositiveInt(overlap);
    if (normalized === null) {
        const cfgOverlap = toPositiveInt(CFG?.rag?.chunkOverlap);
        if (cfgOverlap === null) {
            return 0;
        }
        return Math.min(Math.max(cfgOverlap, 0), Math.max(chunkSize - 1, 0));
    }
    return Math.min(Math.max(normalized, 0), Math.max(chunkSize - 1, 0));
};

const tokenize = (text) => {
    return text
        .split(/\s+/u)
        .map((token) => token.trim())
        .filter((token) => token.length > 0);
};

/**
 * Splits a large text into overlapping chunks suitable for embeddings.
 * @param {string} text - The text to split.
 * @param {{ chunkSize?: number, chunkOverlap?: number }} [options={}] - Chunking configuration overrides.
 * @returns {string[]} Array of chunked text segments respecting the configured size and overlap.
 */
export const chunkText = (text, options = {}) => {
    const normalized = typeof text === "string" ? text.trim() : "";
    if (normalized === "") {
        return [];
    }

    const requestedSize = options?.chunkSize;
    const requestedOverlap = options?.chunkOverlap;

    const chunkSize = resolveChunkSize(requestedSize);
    const chunkOverlap = resolveChunkOverlap(requestedOverlap, chunkSize);
    const step = Math.max(chunkSize - chunkOverlap, 1);

    const tokens = tokenize(normalized);
    if (tokens.length === 0) {
        return [];
    }

    const chunks = [];
    for (let start = 0; start < tokens.length; start += step) {
        const slice = tokens.slice(start, start + chunkSize);
        if (slice.length === 0) {
            continue;
        }
        chunks.push(slice.join(" "));
        if (slice.length < chunkSize) {
            break;
        }
    }

    return chunks;
};

