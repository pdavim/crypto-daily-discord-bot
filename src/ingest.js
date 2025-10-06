import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { ASSETS } from "./assets.js";
import { CFG } from "./config.js";
import { buildHash } from "./alertCache.js";
import { getAssetNews } from "./news.js";
import { logger, withContext } from "./logger.js";
import { chunkText } from "./rag/chunking.js";
import { getEmbedding } from "./rag/embedding.js";
import { upsertDocument } from "./vectorStore.js";

const REPORTS_DIR = path.resolve(process.cwd(), "reports");
const INTERACTIONS_FILE = path.resolve(process.cwd(), "data", "interactions.json");

const SOURCE_POSTS = "posts";
const SOURCE_REPORTS = "reports";
const SOURCE_INTERACTIONS = "interactions";

const isPlainObject = (value) => value != null && typeof value === "object" && !Array.isArray(value);

const toFiniteNumber = (value) => {
    const num = typeof value === "number" ? value : Number.parseFloat(value ?? "");
    return Number.isFinite(num) ? num : null;
};

const toPositiveIntOption = (value, fallback) => {
    const parsed = Number.isFinite(value) ? value : Number.parseInt(value ?? "", 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
    }
    return fallback;
};

const toTimestamp = (value) => {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed === "") {
            return undefined;
        }
        const date = new Date(trimmed);
        if (!Number.isNaN(date.getTime())) {
            return date.toISOString();
        }
        return trimmed;
    }
    return undefined;
};

const composeText = (segments = []) => {
    const normalized = [];
    for (const segment of segments) {
        if (typeof segment === "string") {
            const trimmed = segment.trim();
            if (trimmed !== "") {
                normalized.push(trimmed);
            }
            continue;
        }
        if (Array.isArray(segment)) {
            const nested = composeText(segment);
            if (nested !== "") {
                normalized.push(nested);
            }
            continue;
        }
        if (segment instanceof Date) {
            normalized.push(segment.toISOString());
            continue;
        }
        if (isPlainObject(segment) && typeof segment.text === "string") {
            const trimmed = segment.text.trim();
            if (trimmed !== "") {
                normalized.push(trimmed);
            }
        }
    }
    return normalized.join("\n\n").trim();
};

const cleanMetadata = (metadata, type) => {
    const cleaned = {};
    if (typeof type === "string" && type.trim() !== "") {
        cleaned.type = type.trim();
    }
    if (!isPlainObject(metadata)) {
        return cleaned;
    }
    for (const [key, value] of Object.entries(metadata)) {
        if (key === "type") {
            continue;
        }
        if (value == null) {
            continue;
        }
        if (typeof value === "string") {
            const trimmed = value.trim();
            if (trimmed !== "") {
                cleaned[key] = trimmed;
            }
            continue;
        }
        if (value instanceof Date) {
            cleaned[key] = value.toISOString();
            continue;
        }
        if (typeof value === "number") {
            if (Number.isFinite(value)) {
                cleaned[key] = value;
            }
            continue;
        }
        if (typeof value === "boolean") {
            cleaned[key] = value;
            continue;
        }
        if (Array.isArray(value)) {
            cleaned[key] = value.slice();
            continue;
        }
        if (isPlainObject(value)) {
            cleaned[key] = { ...value };
        }
    }
    return cleaned;
};

const createPostRecord = (post = {}, index = 0) => {
    const baseMetadata = cleanMetadata(post.metadata, SOURCE_POSTS);
    const text = typeof post.text === "string" && post.text.trim() !== ""
        ? post.text.trim()
        : composeText([
            post.title,
            post.summary ?? post.snippet ?? post.description,
            post.content ?? post.body,
        ]);
    if (text === "") {
        return null;
    }

    const title = typeof post.title === "string" && post.title.trim() !== "" ? post.title.trim() : undefined;
    const url = typeof post.url === "string" && post.url.trim() !== "" ? post.url.trim() : undefined;
    const source = typeof post.source === "string" && post.source.trim() !== "" ? post.source.trim() : undefined;
    const assetKey = typeof post.assetKey === "string" && post.assetKey.trim() !== ""
        ? post.assetKey.trim()
        : typeof post.asset === "string" && post.asset.trim() !== ""
            ? post.asset.trim()
            : undefined;
    const publishedAt = toTimestamp(post.publishedAt);
    const sentiment = toFiniteNumber(post.sentiment ?? post.weightedSentiment);

    if (title) {
        baseMetadata.title = title;
    }
    if (url) {
        baseMetadata.url = url;
    }
    if (source) {
        baseMetadata.source = source;
    }
    if (assetKey) {
        baseMetadata.assetKey = assetKey;
    }
    if (publishedAt) {
        baseMetadata.publishedAt = publishedAt;
    }
    if (sentiment !== null) {
        baseMetadata.sentiment = sentiment;
    }

    const seedCandidates = [post.documentId, post.id, url, title, assetKey ? `${assetKey}-${index}` : null];
    let seed = null;
    for (const candidate of seedCandidates) {
        if (typeof candidate === "string" && candidate.trim() !== "") {
            seed = candidate.trim();
            break;
        }
    }
    if (!seed) {
        seed = `${assetKey ?? SOURCE_POSTS}-${text.slice(0, 64)}`;
    }
    const baseId = buildHash(`${SOURCE_POSTS}:${seed}`);

    return { baseId, text, metadata: baseMetadata };
};

const prettifyJson = (raw) => {
    try {
        const parsed = JSON.parse(raw);
        return JSON.stringify(parsed, null, 2);
    } catch (error) {
        return raw;
    }
};

const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".json"]);

const defaultFetchReports = async (log) => {
    const stack = [{ dir: REPORTS_DIR, relative: "" }];
    const reports = [];

    while (stack.length > 0) {
        const { dir, relative } = stack.pop();
        let dirents;
        try {
            dirents = await readdir(dir, { withFileTypes: true });
        } catch (error) {
            if (error?.code !== "ENOENT") {
                log.warn({ fn: "defaultFetchReports", dir, err: error }, "Failed to read reports directory");
            }
            continue;
        }
        for (const entry of dirents) {
            if (entry.isDirectory()) {
                stack.push({ dir: path.join(dir, entry.name), relative: path.join(relative, entry.name) });
                continue;
            }
            if (!entry.isFile()) {
                continue;
            }
            const ext = path.extname(entry.name).toLowerCase();
            if (!TEXT_EXTENSIONS.has(ext)) {
                continue;
            }
            const filePath = path.join(dir, entry.name);
            try {
                const raw = await readFile(filePath, "utf8");
                const text = ext === ".json" ? prettifyJson(raw) : raw;
                reports.push({
                    id: path.join(relative, entry.name),
                    title: entry.name,
                    text,
                    path: path.join(relative, entry.name),
                });
            } catch (error) {
                log.warn({ fn: "defaultFetchReports", path: filePath, err: error }, "Failed to read report file");
            }
        }
    }

    return reports;
};

const createReportRecord = (report = {}) => {
    const baseMetadata = cleanMetadata(report.metadata, SOURCE_REPORTS);
    const text = typeof report.text === "string" && report.text.trim() !== ""
        ? report.text.trim()
        : composeText([report.summary, report.content]);
    if (text === "") {
        return null;
    }

    const title = typeof report.title === "string" && report.title.trim() !== "" ? report.title.trim() : undefined;
    const reportPath = typeof report.path === "string" && report.path.trim() !== "" ? report.path.trim() : undefined;
    if (title) {
        baseMetadata.title = title;
    }
    if (reportPath) {
        baseMetadata.path = reportPath;
    }
    if (Array.isArray(report.tags) && report.tags.length > 0) {
        baseMetadata.tags = report.tags.slice();
    }

    const seedCandidates = [report.id, reportPath, title];
    let seed = null;
    for (const candidate of seedCandidates) {
        if (typeof candidate === "string" && candidate.trim() !== "") {
            seed = candidate.trim();
            break;
        }
    }
    if (!seed) {
        seed = text.slice(0, 64);
    }
    const baseId = buildHash(`${SOURCE_REPORTS}:${seed}`);

    return { baseId, text, metadata: baseMetadata };
};

const defaultFetchInteractions = async (log) => {
    try {
        const raw = await readFile(INTERACTIONS_FILE, "utf8");
        const parsed = JSON.parse(raw);
        const items = Array.isArray(parsed)
            ? parsed
            : Array.isArray(parsed?.items)
                ? parsed.items
                : [];
        return items;
    } catch (error) {
        if (error?.code !== "ENOENT") {
            log.warn({ fn: "defaultFetchInteractions", err: error }, "Failed to read interactions cache");
        }
        return [];
    }
};

const createInteractionRecord = (interaction = {}, index = 0) => {
    const baseMetadata = cleanMetadata(interaction.metadata, SOURCE_INTERACTIONS);
    const text = typeof interaction.text === "string" && interaction.text.trim() !== ""
        ? interaction.text.trim()
        : composeText([
            interaction.prompt ?? interaction.question ?? interaction.message ?? interaction.content ?? interaction.request,
            interaction.response ?? interaction.answer ?? interaction.reply ?? interaction.output ?? interaction.result,
        ]);
    if (text === "") {
        return null;
    }

    const user = typeof interaction.user === "string" && interaction.user.trim() !== ""
        ? interaction.user.trim()
        : typeof interaction.username === "string" && interaction.username.trim() !== ""
            ? interaction.username.trim()
            : typeof interaction.author === "string" && interaction.author.trim() !== ""
                ? interaction.author.trim()
                : undefined;
    const channel = typeof interaction.channel === "string" && interaction.channel.trim() !== ""
        ? interaction.channel.trim()
        : typeof interaction.channelId === "string" && interaction.channelId.trim() !== ""
            ? interaction.channelId.trim()
            : undefined;
    const timestamp = toTimestamp(interaction.timestamp ?? interaction.createdAt ?? interaction.time);

    if (user) {
        baseMetadata.user = user;
    }
    if (channel) {
        baseMetadata.channel = channel;
    }
    if (timestamp) {
        baseMetadata.timestamp = timestamp;
    }

    const seedCandidates = [interaction.id, interaction.interactionId, interaction.messageId, `${channel ?? "interaction"}-${index}`];
    let seed = null;
    for (const candidate of seedCandidates) {
        if (typeof candidate === "string" && candidate.trim() !== "") {
            seed = candidate.trim();
            break;
        }
    }
    if (!seed) {
        seed = text.slice(0, 64);
    }
    const baseId = buildHash(`${SOURCE_INTERACTIONS}:${seed}`);

    return { baseId, text, metadata: baseMetadata };
};

const defaultFetchPosts = async (log, options = {}) => {
    const lookbackHours = toPositiveIntOption(options.lookbackHours, 24);
    const limit = toPositiveIntOption(options.limit, 6);
    const posts = [];
    for (const asset of ASSETS) {
        const assetKey = typeof asset?.key === "string" ? asset.key : null;
        if (!assetKey) {
            continue;
        }
        try {
            const result = await getAssetNews({ symbol: assetKey, lookbackHours, limit });
            for (const item of result?.items ?? []) {
                posts.push({
                    ...item,
                    assetKey,
                });
            }
        } catch (error) {
            log.warn({ fn: "defaultFetchPosts", asset: assetKey, err: error }, "Failed to fetch asset news; skipping asset");
        }
    }
    return posts;
};

const processChunks = async ({ source, baseId, text, metadata, chunkOptions, embeddingOptions }, log) => {
    let segments;
    try {
        segments = chunkText(text, chunkOptions);
    } catch (error) {
        log.error({ source, baseId, err: error }, "Failed to chunk document text");
        return { chunks: 0, successes: 0, failures: 1 };
    }

    const filtered = [];
    for (const segment of segments) {
        if (typeof segment !== "string") {
            continue;
        }
        const trimmed = segment.trim();
        if (trimmed !== "") {
            filtered.push(trimmed);
        }
    }

    if (filtered.length === 0) {
        return { chunks: 0, successes: 0, failures: 0 };
    }

    const baseMetadata = isPlainObject(metadata) ? { ...metadata } : {};
    let successes = 0;
    let failures = 0;

    for (let index = 0; index < filtered.length; index += 1) {
        const chunk = filtered[index];
        const chunkIndex = index + 1;
        let embedding;
        try {
            embedding = await getEmbedding(chunk, embeddingOptions);
        } catch (error) {
            failures += 1;
            log.error({ source, baseId, chunkIndex, err: error }, "Failed to generate embedding for chunk");
            continue;
        }
        try {
            await upsertDocument({
                documentId: `${source}:${baseId}:${chunkIndex}`,
                source,
                chunkId: `chunk-${chunkIndex}`,
                content: chunk,
                metadata: {
                    ...baseMetadata,
                    chunkIndex,
                    totalChunks: filtered.length,
                },
                hash: buildHash(chunk),
                embedding,
            });
            successes += 1;
        } catch (error) {
            failures += 1;
            log.error({ source, baseId, chunkIndex, err: error }, "Failed to upsert chunk in vector store");
        }
    }

    return { chunks: filtered.length, successes, failures };
};

const ingestCollection = async ({ source, fetchItems, transform, log, chunkOptions, embeddingOptions }) => {
    log.info({ source }, `Starting ${source} ingestion`);
    let rawItems;
    try {
        rawItems = await fetchItems();
    } catch (error) {
        log.error({ source, err: error }, `Failed to fetch ${source} items`);
        throw error;
    }

    const items = Array.isArray(rawItems) ? rawItems : [];
    let processed = 0;
    let skipped = 0;
    let stored = 0;
    let chunks = 0;
    let errors = 0;

    for (let index = 0; index < items.length; index += 1) {
        const record = transform(items[index], index, log);
        if (!record || typeof record.text !== "string" || record.text.trim() === "") {
            skipped += 1;
            continue;
        }
        processed += 1;
        const result = await processChunks({
            source,
            baseId: record.baseId,
            text: record.text,
            metadata: record.metadata,
            chunkOptions,
            embeddingOptions,
        }, log);
        stored += result.successes;
        chunks += result.chunks;
        errors += result.failures;
    }

    const summary = { source, items: processed, skipped, chunks, stored, errors };
    log.info(summary, `Completed ${source} ingestion`);
    return summary;
};

/**
 * Ingests recent posts and news articles into the vector store.
 * @param {{ fetchPosts?: Function, chunkSize?: number, chunkOverlap?: number, model?: string, lookbackHours?: number, limit?: number }} [options={}] - Overrides for data sources and chunking.
 * @returns {Promise<{source: string, items: number, skipped: number, chunks: number, stored: number, errors: number}>}
 */
export const ingestPosts = async (options = {}) => {
    const log = withContext(logger, { fn: "ingestPosts" });
    const fetcher = typeof options.fetchPosts === "function"
        ? () => options.fetchPosts({ log })
        : () => defaultFetchPosts(log, options);
    const chunkOptions = {
        chunkSize: options.chunkSize,
        chunkOverlap: options.chunkOverlap,
    };
    const embeddingOptions = {
        model: options.model ?? CFG?.rag?.embeddingModel,
    };
    return ingestCollection({
        source: SOURCE_POSTS,
        fetchItems: fetcher,
        transform: createPostRecord,
        log,
        chunkOptions,
        embeddingOptions,
    });
};

/**
 * Ingests generated reports from the reports directory into the vector store.
 * @param {{ fetchReports?: Function, chunkSize?: number, chunkOverlap?: number, model?: string }} [options={}] - Overrides for data sources and chunking.
 * @returns {Promise<{source: string, items: number, skipped: number, chunks: number, stored: number, errors: number}>}
 */
export const ingestReports = async (options = {}) => {
    const log = withContext(logger, { fn: "ingestReports" });
    const fetcher = typeof options.fetchReports === "function"
        ? () => options.fetchReports({ log })
        : () => defaultFetchReports(log);
    const chunkOptions = {
        chunkSize: options.chunkSize,
        chunkOverlap: options.chunkOverlap,
    };
    const embeddingOptions = {
        model: options.model ?? CFG?.rag?.embeddingModel,
    };
    return ingestCollection({
        source: SOURCE_REPORTS,
        fetchItems: fetcher,
        transform: createReportRecord,
        log,
        chunkOptions,
        embeddingOptions,
    });
};

/**
 * Ingests cached Discord interactions or prompts into the vector store.
 * @param {{ fetchInteractions?: Function, chunkSize?: number, chunkOverlap?: number, model?: string }} [options={}] - Overrides for data sources and chunking.
 * @returns {Promise<{source: string, items: number, skipped: number, chunks: number, stored: number, errors: number}>}
 */
export const ingestInteractions = async (options = {}) => {
    const log = withContext(logger, { fn: "ingestInteractions" });
    const fetcher = typeof options.fetchInteractions === "function"
        ? () => options.fetchInteractions({ log })
        : () => defaultFetchInteractions(log);
    const chunkOptions = {
        chunkSize: options.chunkSize,
        chunkOverlap: options.chunkOverlap,
    };
    const embeddingOptions = {
        model: options.model ?? CFG?.rag?.embeddingModel,
    };
    return ingestCollection({
        source: SOURCE_INTERACTIONS,
        fetchItems: fetcher,
        transform: createInteractionRecord,
        log,
        chunkOptions,
        embeddingOptions,
    });
};

