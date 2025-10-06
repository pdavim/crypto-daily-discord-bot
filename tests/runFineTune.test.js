import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CFG } from "../src/config.js";

let accessMock = vi.fn();
vi.mock("node:fs/promises", async (importOriginal) => {
    const actual = await importOriginal();
    return new Proxy(actual, {
        get(target, prop, receiver) {
            if (prop === "access") {
                return (...args) => accessMock(...args);
            }
            return Reflect.get(target, prop, receiver);
        },
    });
});

let createReadStreamMock = vi.fn();
vi.mock("node:fs", async (importOriginal) => {
    const actual = await importOriginal();
    return new Proxy(actual, {
        get(target, prop, receiver) {
            if (prop === "createReadStream") {
                return (...args) => createReadStreamMock(...args);
            }
            return Reflect.get(target, prop, receiver);
        },
    });
});

let queryMock = vi.fn();
vi.mock("../src/db.js", () => ({
    query: (...args) => queryMock(...args),
}));

let withContextMock = vi.fn((logger, ctx) => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    ctx,
}));
vi.mock("../src/logger.js", () => ({
    logger: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
    },
    withContext: (...args) => withContextMock(...args),
}));

let filesCreateMock = vi.fn();
let jobsCreateMock = vi.fn();
let jobsRetrieveMock = vi.fn();
let openAiConstructorMock = vi.fn();

vi.mock("openai", () => ({
    default: class MockOpenAI {
        constructor(config) {
            openAiConstructorMock(config);
            this.files = {
                create: (...args) => filesCreateMock(...args),
            };
            this.fineTuning = {
                jobs: {
                    create: (...args) => jobsCreateMock(...args),
                    retrieve: (...args) => jobsRetrieveMock(...args),
                },
            };
        }
    },
}));

describe("runFineTune", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        accessMock = vi.fn();
        createReadStreamMock = vi.fn();
        queryMock = vi.fn();
        withContextMock = vi.fn((logger, ctx) => ({
            info: vi.fn(),
            error: vi.fn(),
            warn: vi.fn(),
            ctx,
        }));
        filesCreateMock = vi.fn();
        jobsCreateMock = vi.fn();
        jobsRetrieveMock = vi.fn();
        openAiConstructorMock = vi.fn();
        accessMock.mockResolvedValue();
        createReadStreamMock.mockReturnValue("stream");
        filesCreateMock.mockResolvedValue({ id: "file-1" });
        jobsCreateMock.mockResolvedValue({ id: "job-1", status: "queued" });
        jobsRetrieveMock.mockResolvedValue({ id: "job-1", status: "succeeded", fine_tuned_model: "ft:gpt-default" });
        queryMock.mockResolvedValue({ rows: [] });
        CFG.openaiApiKey = "test-key";
        CFG.rag = {
            ...CFG.rag,
            pgUrl: "postgres://example", 
            modelRegistry: {
                schema: "public",
                table: "rag_models",
                columns: {
                    name: "name",
                    status: "status",
                    jobId: "job_id",
                    fileId: "training_file",
                    metadata: "metadata",
                },
            },
        };
    });

    afterEach(() => {
        delete process.env.OPENAI_API_KEY;
    });

    it("uploads the dataset, waits for completion and records the model", async () => {
        const jobStates = [
            { id: "job-1", status: "queued" },
            { id: "job-1", status: "running" },
            { id: "job-1", status: "succeeded", fine_tuned_model: "ft:gpt-alpha", finished_at: "2024-01-01T00:00:00Z" },
        ];
        let retrieveCalls = 0;
        jobsRetrieveMock.mockImplementation(async () => {
            const state = jobStates[Math.min(retrieveCalls, jobStates.length - 1)];
            retrieveCalls += 1;
            return state;
        });

        const { runFineTune } = await import("../scripts/run-fine-tune.js");
        const datasetPath = "/tmp/fine-tune.jsonl";
        const result = await runFineTune({ datasetPath, pollIntervalMs: 0, baseModel: "gpt-4o-mini" });

        expect(accessMock).toHaveBeenCalledWith(path.resolve(datasetPath));
        expect(createReadStreamMock).toHaveBeenCalledWith(path.resolve(datasetPath));
        expect(openAiConstructorMock).toHaveBeenCalledWith({ apiKey: "test-key" });
        expect(filesCreateMock).toHaveBeenCalledWith({ file: "stream", purpose: "fine-tune" });
        expect(jobsCreateMock).toHaveBeenCalledWith({ training_file: "file-1", model: "gpt-4o-mini" });
        expect(jobsRetrieveMock).toHaveBeenCalledTimes(3);
        expect(queryMock).toHaveBeenCalledTimes(1);
        const [sql, params] = queryMock.mock.calls[0];
        expect(sql).toContain("INSERT INTO");
        expect(sql).toContain("\"rag_models\"");
        expect(params[0]).toBe("ft:gpt-alpha");
        expect(params[1]).toBe("succeeded");
        expect(params[2]).toBe("job-1");
        expect(params[3]).toBe("file-1");
        expect(params[4]).toMatchObject({
            baseModel: "gpt-4o-mini",
            trainingFileId: "file-1",
        });
        expect(result).toEqual({
            jobId: "job-1",
            status: "succeeded",
            model: "ft:gpt-alpha",
            trainingFileId: "file-1",
        });
    });

    it("throws when the fine-tune job fails", async () => {
        const jobStates = [
            { id: "job-2", status: "queued" },
            { id: "job-2", status: "running" },
            { id: "job-2", status: "failed", error: { message: "validation error" } },
        ];
        let retrieveCalls = 0;
        jobsRetrieveMock.mockImplementation(async () => {
            const state = jobStates[Math.min(retrieveCalls, jobStates.length - 1)];
            retrieveCalls += 1;
            return state;
        });

        const { runFineTune } = await import("../scripts/run-fine-tune.js");
        const datasetPath = "/tmp/fine-tune.jsonl";

        await expect(runFineTune({ datasetPath, pollIntervalMs: 0 })).rejects.toThrow(/status failed/i);
        expect(jobsRetrieveMock).toHaveBeenCalledTimes(3);
        expect(queryMock).not.toHaveBeenCalled();
    });
});
