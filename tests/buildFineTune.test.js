import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listApprovedExamplesMock = vi.fn();

vi.mock("../src/feedback.js", () => ({
    listApprovedExamples: listApprovedExamplesMock,
}));

const cleanupDirs = [];

const createTempDir = async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fine-tune-test-"));
    cleanupDirs.push(dir);
    return dir;
};

afterEach(async () => {
    while (cleanupDirs.length > 0) {
        const dir = cleanupDirs.pop();
        try {
            await fs.rm(dir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors in tests.
        }
    }
});

describe("buildFineTuneDataset", () => {
    let buildFineTuneDataset;

    beforeEach(async () => {
        vi.resetModules();
        vi.clearAllMocks();
        ({ buildFineTuneDataset } = await import("../bin/buildFineTuneDataset.js"));
    });

    it("agrupa snapshots e indicadores dos exemplos aprovados", async () => {
        const baseDir = await createTempDir();
        const reportsDir = path.join(baseDir, "reports");
        await fs.mkdir(reportsDir, { recursive: true });
        const sourcePath = path.join(reportsDir, "btc.json");
        await fs.writeFile(sourcePath, JSON.stringify({
            snapshots: {
                "4h": { kpis: { price: 35000, var24h: 0.025 } },
                "1h": { kpis: { var: -0.01 } },
            },
            indicators: {
                rsi: 55,
                macd: { hist: 0.002 },
                ema: [10, 20],
            },
        }), "utf8");
        listApprovedExamplesMock.mockResolvedValue([
            {
                question: "Qual a análise recente do BTC?",
                answer: "O BTC mantém viés de alta com leve correção.",
                sources: ["reports/btc.json", "https://example.com/extra"],
            },
        ]);
        const outputPath = path.join(baseDir, "fine-tune.jsonl");

        const dataset = await buildFineTuneDataset({ baseDir, outputPath });

        expect(dataset).toHaveLength(1);
        const entry = dataset[0];
        expect(entry.prompt).toContain("Pergunta:\nQual a análise recente do BTC?");
        expect(entry.prompt).toContain("Snapshots agregados:");
        expect(entry.prompt).toContain("- 4h: price=35000, var24h=0.025");
        expect(entry.prompt).toContain("- 1h: var=-0.01");
        expect(entry.prompt).toContain("Indicadores agregados:");
        expect(entry.prompt).toContain("macd.hist: 0.002");
        expect(entry.prompt).toContain("ema: 10, 20");
        expect(entry.prompt).toContain("Fontes:");
        expect(entry.prompt).toContain("[1] reports/btc.json");
        expect(entry.prompt).toContain("[2] https://example.com/extra");
        expect(entry.completion).toBe("O BTC mantém viés de alta com leve correção.");

        const written = await fs.readFile(outputPath, "utf8");
        expect(written.endsWith("\n")).toBe(true);
        const [serialized] = written.trim().split("\n");
        expect(JSON.parse(serialized)).toEqual(entry);
    });

    it("ignora fontes inexistentes e remove duplicidades nas referências", async () => {
        const baseDir = await createTempDir();
        const docsDir = path.join(baseDir, "docs");
        await fs.mkdir(docsDir, { recursive: true });
        const docPath = path.join(docsDir, "guia.md");
        await fs.writeFile(docPath, "# Guia", "utf8");
        listApprovedExamplesMock.mockResolvedValue([
            {
                question: "  Como aprovo exemplos?  ",
                answer: "Use a ferramenta de moderação e aprove pelo ID.",
                sources: ["https://docs.example.com/moderation", "docs/guia.md", "docs/guia.md"],
            },
        ]);
        const outputPath = path.join(baseDir, "dataset.jsonl");

        const dataset = await buildFineTuneDataset({ baseDir, outputPath });

        expect(dataset).toHaveLength(1);
        const entry = dataset[0];
        expect(entry.prompt).toContain("Pergunta:\nComo aprovo exemplos?");
        expect(entry.prompt).not.toContain("Snapshots agregados:");
        expect(entry.prompt).not.toContain("Indicadores agregados:");
        expect(entry.prompt.match(/Fontes:/)).toBeTruthy();
        expect(entry.prompt.match(/\[1\] https:\/\/docs\.example\.com\/moderation/)).toBeTruthy();
        expect(entry.prompt.match(/\[2\] docs\/guia\.md/)).toBeTruthy();
        expect(entry.prompt.match(/\[3\]/)).toBeNull();
        expect(entry.completion).toBe("Use a ferramenta de moderação e aprove pelo ID.");

        const written = await fs.readFile(outputPath, "utf8");
        expect(written.endsWith("\n")).toBe(true);
        const [serialized] = written.trim().split("\n");
        expect(JSON.parse(serialized)).toEqual(entry);
    });
});
