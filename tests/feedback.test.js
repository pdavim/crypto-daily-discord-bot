import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();

vi.mock("../src/db.js", () => ({
    query: queryMock,
}));

describe("feedback persistence", () => {
    let recordInteraction;
    let recordFeedback;
    let listApprovedExamples;
    let feedbackInteractionCounter;
    let feedbackRatingCounter;

    beforeEach(async () => {
        vi.resetModules();
        queryMock.mockReset();
        ({ feedbackInteractionCounter, feedbackRatingCounter } = await import("../src/metrics.js"));
        feedbackInteractionCounter.reset();
        feedbackRatingCounter.reset();
        ({ recordInteraction, recordFeedback, listApprovedExamples } = await import("../src/feedback.js"));
    });

    it("inserts a new interaction and increments metrics", async () => {
        queryMock.mockResolvedValueOnce({ rows: [{ id: 42 }], rowCount: 1 });
        const id = await recordInteraction({
            question: "  Como funciona?  ",
            answer: "  Funciona assim.  ",
            sources: [" docs/a.md ", "", "https://example.com  "],
        });
        expect(id).toBe(42);
        expect(queryMock).toHaveBeenCalledWith(
            expect.stringContaining("INSERT INTO feedback"),
            ["Como funciona?", "Funciona assim.", ["docs/a.md", "https://example.com"]],
        );
        const metrics = feedbackInteractionCounter.get();
        expect(metrics.values[0]?.value ?? 0).toBe(1);
    });

    it("updates rating when entry exists and tracks metric", async () => {
        queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 7 }] });
        await recordFeedback({
            rating: "up",
            question: " Pergunta ",
            answer: " Resposta ",
            sources: ["docs/b.md"],
        });
        expect(queryMock).toHaveBeenCalledWith(
            expect.stringContaining("UPDATE feedback"),
            ["up", "Pergunta", "Resposta", ["docs/b.md"]],
        );
        const ratings = feedbackRatingCounter.get();
        const upEntry = ratings.values.find((item) => item.labels.rating === "up");
        expect(upEntry?.value ?? 0).toBe(1);
    });

    it("inserts rating when update finds no match", async () => {
        queryMock
            .mockResolvedValueOnce({ rowCount: 0 })
            .mockResolvedValueOnce({ rowCount: 1 });
        await recordFeedback({
            rating: "down",
            question: "Pergunta 2",
            answer: "Resposta 2",
            sources: [],
        });
        expect(queryMock).toHaveBeenNthCalledWith(
            1,
            expect.stringContaining("UPDATE feedback"),
            ["down", "Pergunta 2", "Resposta 2", []],
        );
        expect(queryMock).toHaveBeenNthCalledWith(
            2,
            expect.stringContaining("INSERT INTO feedback"),
            ["down", "Pergunta 2", "Resposta 2", []],
        );
    });

    it("lists approved examples", async () => {
        queryMock.mockResolvedValueOnce({
            rows: [
                { question: " Q1 ", answer: " A1 ", sources: [" docs/x.md ", " "] },
                { question: "", answer: "A2", sources: null },
            ],
        });
        const rows = await listApprovedExamples();
        expect(queryMock).toHaveBeenCalledWith(
            "SELECT question, answer, sources FROM feedback WHERE approved = TRUE ORDER BY created_at ASC;",
        );
        expect(rows).toEqual([
            { question: "Q1", answer: "A1", sources: ["docs/x.md"] },
        ]);
    });

    it("throws for invalid rating", async () => {
        await expect(recordFeedback({ rating: "meh", question: "q", answer: "a" })).rejects.toThrow(/Rating/);
    });
});
