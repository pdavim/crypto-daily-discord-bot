import { toSql } from "pgvector/utils";
import { v4 as uuidv4 } from "uuid";
import { CFG } from "./config.js";
import { query } from "./db.js";

const UPSERT_DOCUMENT_SQL = `
    INSERT INTO rag_documents (
        document_id,
        source,
        chunk_id,
        content,
        metadata,
        hash,
        embedding,
        updated_at
    )
    VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, NOW())
    ON CONFLICT (document_id)
    DO UPDATE SET
        source = EXCLUDED.source,
        chunk_id = EXCLUDED.chunk_id,
        content = EXCLUDED.content,
        metadata = EXCLUDED.metadata,
        hash = EXCLUDED.hash,
        embedding = EXCLUDED.embedding,
        updated_at = NOW()
    RETURNING document_id;
`.trim();

const DELETE_ALL_BY_SOURCE_SQL = `
    DELETE FROM rag_documents
    WHERE source = $1;
`.trim();

const DELETE_STALE_BY_SOURCE_SQL = `
    DELETE FROM rag_documents
    WHERE source = $1
      AND NOT (document_id = ANY($2::text[]));
`.trim();

const DEFAULT_SEARCH_LIMIT = 5;

const normalizeEmbedding = (embedding) => {
    if (!Array.isArray(embedding) || embedding.length === 0) {
        throw new TypeError("Embedding must be a non-empty array of numbers.");
    }

    const values = embedding.map((value) => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
            throw new TypeError("Embedding values must be finite numbers.");
        }
        return parsed;
    });

    return values;
};

const normalizeOptionalString = (value) => {
    if (typeof value !== "string") {
        return null;
    }

    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
};

const serializeMetadata = (metadata) => {
    if (metadata == null) {
        return "{}";
    }

    if (typeof metadata === "string") {
        const trimmed = metadata.trim();
        return trimmed === "" ? "{}" : trimmed;
    }

    try {
        return JSON.stringify(metadata);
    } catch (error) {
        return "{}";
    }
};

const resolveSearchLimit = (limit) => {
    const baseLimit = Number.isFinite(limit) ? limit : Number.parseInt(limit ?? "", 10);
    if (Number.isFinite(baseLimit) && baseLimit > 0) {
        return baseLimit;
    }

    const cfgLimit = Number.isFinite(CFG?.rag?.searchLimit)
        ? CFG.rag.searchLimit
        : DEFAULT_SEARCH_LIMIT;

    return Number.isFinite(cfgLimit) && cfgLimit > 0 ? cfgLimit : DEFAULT_SEARCH_LIMIT;
};

export const upsertDocument = async ({
    documentId = uuidv4(),
    source,
    chunkId = null,
    content = "",
    metadata = {},
    hash = null,
    embedding,
}) => {
    const normalizedSource = typeof source === "string" ? source.trim() : "";
    if (normalizedSource === "") {
        throw new Error("upsertDocument requires a non-empty source identifier.");
    }

    const normalizedContent = typeof content === "string" ? content : String(content ?? "");
    const normalizedChunkId = normalizeOptionalString(chunkId);
    const normalizedHash = normalizeOptionalString(hash);
    const serializedMetadata = serializeMetadata(metadata);
    const vector = toSql(normalizeEmbedding(embedding));

    const result = await query(UPSERT_DOCUMENT_SQL, [
        documentId,
        normalizedSource,
        normalizedChunkId,
        normalizedContent,
        serializedMetadata,
        normalizedHash,
        vector,
    ]);

    return result.rows?.[0] ?? null;
};

export const searchEmbeddings = async ({ embedding, sources = [], limit } = {}) => {
    const vector = toSql(normalizeEmbedding(embedding));
    const normalizedSources = Array.isArray(sources)
        ? sources
            .map((value) => (typeof value === "string" ? value.trim() : ""))
            .filter((value) => value !== "")
        : [];

    const params = [vector];
    const conditions = [];
    let nextIndex = 2;

    if (normalizedSources.length > 0) {
        conditions.push(`source = ANY($${nextIndex}::text[])`);
        params.push(normalizedSources);
        nextIndex += 1;
    }

    const resolvedLimit = resolveSearchLimit(limit);
    params.push(resolvedLimit);

    const sql = [
        "SELECT",
        "    document_id,",
        "    source,",
        "    chunk_id,",
        "    content,",
        "    metadata,",
        "    hash,",
        "    embedding <=> $1 AS distance",
        "FROM rag_documents",
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
        "ORDER BY embedding <=> $1",
        `LIMIT $${nextIndex};`,
    ].filter(Boolean).join("\n");

    const result = await query(sql, params);
    return result.rows ?? [];
};

export const deleteStaleDocuments = async (source, keepDocumentIds = []) => {
    const normalizedSource = typeof source === "string" ? source.trim() : "";
    if (normalizedSource === "") {
        throw new Error("deleteStaleDocuments requires a non-empty source identifier.");
    }

    const normalizedIds = Array.isArray(keepDocumentIds)
        ? keepDocumentIds
            .map((value) => (typeof value === "string" ? value.trim() : ""))
            .filter((value) => value !== "")
        : [];

    if (normalizedIds.length === 0) {
        const result = await query(DELETE_ALL_BY_SOURCE_SQL, [normalizedSource]);
        return result.rowCount ?? 0;
    }

    const result = await query(DELETE_STALE_BY_SOURCE_SQL, [normalizedSource, normalizedIds]);
    return result.rowCount ?? 0;
};
