import { beforeEach, describe, expect, it, vi } from "vitest";

const answerWithRAGMock = vi.fn();
const recordFeedbackMock = vi.fn();

vi.mock("../src/rag.js", () => ({
    answerWithRAG: answerWithRAGMock,
    recordFeedback: recordFeedbackMock,
}));

describe("handleInteraction /ask", () => {
    let handleInteraction;

    beforeEach(async () => {
        vi.clearAllMocks();
        ({ handleInteraction } = await import("../src/discordBot.js"));
    });

    it("defer, asks RAG and replies with formatted sources and feedback buttons", async () => {
        answerWithRAGMock.mockResolvedValue({
            answer: "Resposta detalhada sobre o funcionamento do bot.",
            sources: [
                { source: "docs/alpha.md" },
                { source: "https://example.com/ref" },
            ],
        });
        const deferReply = vi.fn().mockResolvedValue();
        const editReply = vi.fn().mockResolvedValue();
        const getString = vi.fn((name) => {
            if (name === "question") {
                return "  O que é o modo RAG?  ";
            }
            return null;
        });
        const interaction = {
            isButton: () => false,
            isChatInputCommand: () => true,
            commandName: "ask",
            options: { getString },
            deferReply,
            editReply,
        };

        await handleInteraction(interaction);

        expect(deferReply).toHaveBeenCalledWith({ ephemeral: true });
        expect(answerWithRAGMock).toHaveBeenCalledWith("O que é o modo RAG?");
        const response = editReply.mock.calls[0][0];
        expect(response.content).toContain("**Pergunta:** O que é o modo RAG?");
        expect(response.content).toContain("🧠 **Resposta:**");
        expect(response.content).toContain("Resposta detalhada");
        expect(response.content).toContain("1. [docs/alpha.md](docs/alpha.md)");
        expect(response.content).toContain("2. [https://example.com/ref](https://example.com/ref)");
        expect(Array.isArray(response.components)).toBe(true);
        expect(response.components).toHaveLength(1);
        const row = response.components[0];
        const rowJson = typeof row?.toJSON === "function" ? row.toJSON() : row;
        expect(rowJson.components).toHaveLength(2);
        expect(rowJson.components[0].custom_id).toBe("ask:feedback:up");
        expect(rowJson.components[1].custom_id).toBe("ask:feedback:down");
    });

    it("registra feedback quando um botão é clicado", async () => {
        const reply = vi.fn().mockResolvedValue();
        const interaction = {
            isButton: () => true,
            customId: "ask:feedback:up",
            message: {
                id: "msg-123",
                content: "❓ **Pergunta:** O que é RAG?\n\n🧠 **Resposta:**\nUma resposta exemplo.\n\n🔗 **Fontes:**\n1. [docs/alpha.md](docs/alpha.md)",
            },
            user: { id: "user-456" },
            reply,
        };

        await handleInteraction(interaction);

        expect(recordFeedbackMock).toHaveBeenCalledWith({
            rating: "up",
            messageId: "msg-123",
            userId: "user-456",
            question: "O que é RAG?",
            answer: "Uma resposta exemplo.",
            sources: ["docs/alpha.md"],
        });
        expect(reply).toHaveBeenCalledWith({ content: expect.stringContaining("Obrigado"), ephemeral: true });
    });
});
