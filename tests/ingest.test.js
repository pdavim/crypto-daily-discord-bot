import { describe, it, expect, vi } from "vitest";

vi.mock("../src/logger.js", () => {
    const baseLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    };
    const instances = [];
    const withContext = vi.fn(() => {
        const entry = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        };
        instances.push(entry);
        return entry;
    });
    withContext.instances = instances;
    return { logger: baseLogger, withContext };
});

vi.mock("../src/db.js", () => ({
    query: vi.fn(async () => ({ rows: [] })),
}));

describe("chunkText", () => {
    it("splits text respecting size and overlap", async () => {
        vi.resetModules();
        const { chunkText } = await import("../src/rag/chunking.js");
        const tokens = Array.from({ length: 450 }, (_, index) => `token${index}`);
        const text = tokens.join(" ");
        const chunks = chunkText(text, { chunkSize: 200, chunkOverlap: 50 });
        expect(chunks).toHaveLength(3);
        expect(chunks[0].split(/\s+/u)).toHaveLength(200);
        expect(chunks[1].split(/\s+/u)[0]).toBe("token150");
    });
});

describe("ingestPosts", () => {
    it("chunks posts and stores embeddings for each segment", async () => {
        vi.resetModules();
        const chunkingModule = await import("../src/rag/chunking.js");
        const chunkSpy = vi.spyOn(chunkingModule, "chunkText").mockReturnValue(["chunk-one", "chunk-two"]);
        const embeddingModule = await import("../src/rag/embedding.js");
        const embeddingSpy = vi.spyOn(embeddingModule, "getEmbedding").mockResolvedValue([0.1, 0.2, 0.3]);
        const vectorStoreModule = await import("../src/vectorStore.js");
        const upsertSpy = vi.spyOn(vectorStoreModule, "upsertDocument").mockResolvedValue({ document_id: "doc" });
        const { ingestPosts } = await import("../src/ingest.js");
        const result = await ingestPosts({
            fetchPosts: async () => [{
                id: "post-1",
                title: "Alpha rally continues",
                summary: "Markets extend their gains",
                content: "Detailed analysis of the rally.",
                url: "https://example.com/news/alpha",
                source: "Example",
                assetKey: "BTC",
                publishedAt: "2024-01-01T00:00:00Z",
                sentiment: 0.75,
            }],
            chunkSize: 200,
            chunkOverlap: 50,
            model: "test-embedding",
        });
        expect(chunkSpy).toHaveBeenCalledTimes(1);
        expect(embeddingSpy).toHaveBeenCalledTimes(2);
        expect(upsertSpy).toHaveBeenCalledTimes(2);
        expect(result).toMatchObject({
            source: "posts",
            items: 1,
            skipped: 0,
            chunks: 2,
            stored: 2,
            errors: 0,
        });
    });

    it("continues processing when an embedding fails", async () => {
        vi.resetModules();
        const chunkingModule = await import("../src/rag/chunking.js");
        vi.spyOn(chunkingModule, "chunkText").mockReturnValue(["chunk-one", "chunk-two"]);
        const embeddingModule = await import("../src/rag/embedding.js");
        const embeddingSpy = vi.spyOn(embeddingModule, "getEmbedding");
        embeddingSpy.mockRejectedValueOnce(new Error("embedding failure"));
        embeddingSpy.mockResolvedValueOnce([0.4, 0.5, 0.6]);
        const vectorStoreModule = await import("../src/vectorStore.js");
        const upsertSpy = vi.spyOn(vectorStoreModule, "upsertDocument").mockResolvedValue({ document_id: "doc" });
        const loggerModule = await import("../src/logger.js");
        loggerModule.withContext.instances.length = 0;
        const { ingestPosts } = await import("../src/ingest.js");
        const result = await ingestPosts({
            fetchPosts: async () => [{
                id: "post-err",
                title: "Volatility spike",
                content: "Markets turned sharply lower.",
            }],
        });
        expect(result.errors).toBe(1);
        expect(result.stored).toBe(1);
        expect(upsertSpy).toHaveBeenCalledTimes(1);
        const errorLogged = loggerModule.withContext.instances.some((entry) => entry.error.mock.calls.length > 0);
        expect(errorLogged).toBe(true);
    });
});

