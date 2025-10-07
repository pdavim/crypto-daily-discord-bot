import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CFG } from "../src/config.js";

const getEmbeddingMock = vi.fn();
vi.mock("../src/rag/embedding.js", () => ({
    getEmbedding: getEmbeddingMock,
}));

const searchEmbeddingsMock = vi.fn();
vi.mock("../src/vectorStore.js", () => ({
    searchEmbeddings: searchEmbeddingsMock,
}));

const callOpenRouterMock = vi.fn();
vi.mock("../src/ai.js", async () => {
    const actual = await vi.importActual("../src/ai.js");
    return {
        ...actual,
        callOpenRouter: callOpenRouterMock,
    };
});

const openAiConstructorMock = vi.fn();
const chatCompletionMock = vi.fn();
vi.mock("openai", () => ({
    default: class MockOpenAI {
        constructor(config) {
            openAiConstructorMock(config);
            this.chat = {
                completions: {
                    create: chatCompletionMock,
                },
            };
        }
    },
}));

let answerWithRAG;
let resetRagClients;

beforeEach(async () => {
    vi.clearAllMocks();
    const module = await import("../src/rag.js");
    answerWithRAG = module.answerWithRAG;
    resetRagClients = module.resetRagClients;
    resetRagClients();
    CFG.rag = {
        ...CFG.rag,
        activeModel: "openrouter/meta-llama/test",
        searchLimit: 2,
    };
    getEmbeddingMock.mockResolvedValue([0.1, 0.2, 0.3]);
    callOpenRouterMock.mockResolvedValue("Resposta gerada [1].");
});

afterEach(() => {
    delete process.env.OPENAI_API_KEY;
});

describe("answerWithRAG", () => {
    it("builds a numbered prompt and returns structured sources", async () => {
        searchEmbeddingsMock.mockResolvedValue([
            {
                document_id: "doc-1",
                source: "docs/alpha.md",
                content: "Alpha content",
                distance: 0.12,
                metadata: { url: "https://example.com/alpha", title: "Alpha Doc" },
            },
            {
                document_id: "doc-2",
                source: "docs/beta.md",
                content: "Beta content",
                distance: 0.34,
                metadata: { url: "https://example.com/beta" },
            },
            {
                document_id: "doc-3",
                source: "docs/gamma.md",
                content: "Gamma content",
                distance: 0.56,
            },
        ]);

        const result = await answerWithRAG("O que é o bot?");

        expect(getEmbeddingMock).toHaveBeenCalledWith("O que é o bot?");
        expect(searchEmbeddingsMock).toHaveBeenCalledWith({
            embedding: [0.1, 0.2, 0.3],
            limit: 2,
        });
        expect(callOpenRouterMock).toHaveBeenCalledTimes(1);
        const [messages, options] = callOpenRouterMock.mock.calls[0];
        expect(options).toEqual({ model: "openrouter/meta-llama/test" });
        const userPrompt = messages[1].content[0].text;
        expect(userPrompt).toContain("Fontes numeradas:");
        expect(userPrompt).toContain("[1] | docs/alpha.md");
        expect(userPrompt).toContain("[2] | docs/beta.md");
        expect(userPrompt).not.toContain("gamma");

        expect(result.answer).toBe("Resposta gerada [1].");
        expect(result.sources).toHaveLength(2);
        expect(result.sources[0]).toMatchObject({
            id: "doc-1",
            source: "docs/alpha.md",
            citationUrl: "https://example.com/alpha",
            citationLabel: "Alpha Doc",
        });
        expect(result.sources[0].score).toBeCloseTo(1 / (1 + 0.12));
        expect(result.sources[1]).toMatchObject({
            id: "doc-2",
            source: "docs/beta.md",
            citationUrl: "https://example.com/beta",
            citationLabel: "https://example.com/beta",
        });
        expect(result.sources[1].score).toBeCloseTo(1 / (1 + 0.34));
    });

    it("falls back to OpenAI completions when the model is not from OpenRouter", async () => {
        CFG.rag.activeModel = "gpt-4o-mini";
        process.env.OPENAI_API_KEY = "test-key";
        searchEmbeddingsMock.mockResolvedValue([
            {
                document_id: "doc-4",
                source: "docs/delta.md",
                content: "Delta content",
                distance: 0.42,
                metadata: { title: "Delta Doc" },
            },
        ]);
        chatCompletionMock.mockResolvedValue({
            choices: [
                {
                    message: { content: "OpenAI answer" },
                },
            ],
        });

        const result = await answerWithRAG("Explique delta");

        expect(callOpenRouterMock).not.toHaveBeenCalled();
        expect(openAiConstructorMock).toHaveBeenCalledWith({ apiKey: "test-key" });
        expect(chatCompletionMock).toHaveBeenCalledWith({
            model: "gpt-4o-mini",
            messages: expect.any(Array),
        });
        expect(result.answer).toBe("OpenAI answer");
        expect(result.sources).toHaveLength(1);
        expect(result.sources[0]).toMatchObject({
            id: "doc-4",
            source: "docs/delta.md",
            citationUrl: null,
            citationLabel: "Delta Doc",
        });
    });
});

