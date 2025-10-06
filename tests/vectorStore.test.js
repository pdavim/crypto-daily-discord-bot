import { beforeEach, describe, expect, it, vi } from "vitest";

const mockQuery = vi.fn();
const mockEnd = vi.fn();
const mockOn = vi.fn();
const PoolMock = vi.fn(() => ({
    query: mockQuery,
    end: mockEnd,
    on: mockOn,
}));

vi.mock("pg", () => ({
    __esModule: true,
    default: {
        Pool: PoolMock,
        types: {
            setTypeParser: vi.fn(),
            builtins: {},
        },
    },
}));

const registerTypeMock = vi.fn();
vi.mock("pgvector/pg", () => ({
    registerType: registerTypeMock,
}));

const toSqlMock = vi.fn();
vi.mock("pgvector/utils", () => ({
    toSql: toSqlMock,
}));

vi.mock("uuid", () => ({
    v4: vi.fn(() => "uuid-123"),
}));

const cfg = { rag: { pgUrl: "postgres://localhost/test", searchLimit: 5 } };
const onConfigChangeMock = vi.fn(() => () => {});
vi.mock("../src/config.js", () => ({
    CFG: cfg,
    onConfigChange: onConfigChangeMock,
}));

vi.mock("../src/logger.js", () => {
    const log = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    };
    return {
        logger: log,
        withContext: () => log,
    };
});

let upsertDocument;
let searchEmbeddings;

describe("vectorStore", () => {
    beforeEach(async () => {
        vi.resetModules();

        mockQuery.mockReset();
        mockQuery.mockImplementation(() => Promise.resolve({ rows: [], rowCount: 0 }));
        mockEnd.mockReset();
        mockEnd.mockResolvedValue();
        mockOn.mockReset();
        PoolMock.mockClear();
        registerTypeMock.mockClear();
        toSqlMock.mockReset();
        toSqlMock.mockReturnValue("vector_literal");
        onConfigChangeMock.mockClear();

        cfg.rag = { pgUrl: "postgres://localhost/test", searchLimit: 5 };

        ({ upsertDocument, searchEmbeddings } = await import("../src/vectorStore.js"));
    });

    it("serializes embeddings and issues an upsert query", async () => {
        mockQuery.mockResolvedValueOnce({ rows: [{ document_id: "uuid-123" }] });

        const result = await upsertDocument({
            source: "news",
            chunkId: "chunk-42",
            content: "Conteúdo analisado",
            metadata: { language: "pt-BR" },
            hash: "abc123",
            embedding: [0.12, 0.34, 0.56],
        });

        expect(toSqlMock).toHaveBeenCalledWith([0.12, 0.34, 0.56]);
        expect(mockQuery).toHaveBeenCalledTimes(1);

        const [sql, params] = mockQuery.mock.calls[0];
        expect(sql).toContain("INSERT INTO rag_documents");
        expect(sql).toContain("ON CONFLICT (document_id)");
        expect(params).toEqual([
            "uuid-123",
            "news",
            "chunk-42",
            "Conteúdo analisado",
            JSON.stringify({ language: "pt-BR" }),
            "abc123",
            "vector_literal",
        ]);
        expect(result).toEqual({ document_id: "uuid-123" });
    });

    it("builds a cosine search query with optional source filters", async () => {
        mockQuery.mockResolvedValueOnce({ rows: [{ document_id: "doc-1", distance: 0.42 }] });

        const rows = await searchEmbeddings({
            embedding: [0.1, 0.2],
            sources: ["news"],
            limit: 3,
        });

        expect(toSqlMock).toHaveBeenCalledWith([0.1, 0.2]);
        expect(mockQuery).toHaveBeenCalledTimes(1);

        const [sql, params] = mockQuery.mock.calls[0];
        expect(sql).toContain("SELECT");
        expect(sql).toContain("embedding <=> $1 AS distance");
        expect(sql).toContain("ORDER BY embedding <=> $1");
        expect(sql).toContain("WHERE source = ANY($2::text[])");
        expect(sql).toContain("LIMIT $3;");
        expect(params).toEqual(["vector_literal", ["news"], 3]);
        expect(rows).toEqual([{ document_id: "doc-1", distance: 0.42 }]);
    });
});
