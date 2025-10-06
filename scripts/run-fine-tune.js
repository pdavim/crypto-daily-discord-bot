#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import OpenAI from "openai";

import { CFG } from "../src/config.js";
import { query } from "../src/db.js";
import { logger, withContext } from "../src/logger.js";

const DEFAULT_DATASET_PATH = path.resolve(process.cwd(), "data", "fine-tune.jsonl");
const DEFAULT_BASE_MODEL = "gpt-4o-mini";
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);

const isPlainObject = (value) => value != null && typeof value === "object" && !Array.isArray(value);

const toNonEmptyString = (value) => {
    if (typeof value !== "string") {
        return "";
    }
    const trimmed = value.trim();
    return trimmed === "" ? "" : trimmed;
};

const quoteIdentifier = (identifier) => {
    const normalized = toNonEmptyString(identifier);
    if (normalized === "") {
        throw new Error("Identifier must be a non-empty string.");
    }
    return `"${normalized.replace(/"/g, '""')}"`;
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const resolveDatasetPath = async (providedPath) => {
    const candidate = toNonEmptyString(providedPath);
    const resolved = candidate ? path.resolve(candidate) : DEFAULT_DATASET_PATH;
    try {
        await access(resolved);
        return resolved;
    } catch (error) {
        const message = `Training dataset not found at ${resolved}.`;
        throw new Error(message, { cause: error });
    }
};

const resolveApiKey = () => {
    const cfgKey = toNonEmptyString(CFG?.openaiApiKey);
    if (cfgKey) {
        return cfgKey;
    }
    const envKey = toNonEmptyString(process.env.OPENAI_API_KEY);
    if (envKey) {
        return envKey;
    }
    throw new Error("OpenAI API key is not configured.");
};

const createClient = () => {
    const apiKey = resolveApiKey();
    return new OpenAI({ apiKey });
};

const resolveBaseModel = (providedModel) => {
    const candidates = [
        providedModel,
        process.env.RAG_FINE_TUNE_MODEL,
        process.env.OPENAI_FINE_TUNE_MODEL,
        CFG?.rag?.candidateModel,
        CFG?.rag?.activeModel,
        DEFAULT_BASE_MODEL,
    ];
    for (const candidate of candidates) {
        const normalized = toNonEmptyString(candidate);
        if (normalized) {
            return normalized;
        }
    }
    return DEFAULT_BASE_MODEL;
};

const resolveRegistryColumns = (columns) => {
    if (!isPlainObject(columns)) {
        return {
            name: "name",
            status: "status",
            jobId: "job_id",
            fileId: "training_file",
            metadata: "metadata",
        };
    }
    return {
        name: toNonEmptyString(columns.name) || "name",
        status: toNonEmptyString(columns.status) || "status",
        jobId: toNonEmptyString(columns.jobId) || "job_id",
        fileId: toNonEmptyString(columns.fileId) || "training_file",
        metadata: toNonEmptyString(columns.metadata) || "metadata",
    };
};

const persistModelRecord = async ({ modelName, status, jobId, trainingFileId, baseModel, job, log }) => {
    const registry = CFG?.rag?.modelRegistry;
    if (!isPlainObject(registry)) {
        log.warn({ jobId }, "Model registry not configured; skipping persistence");
        return null;
    }
    if (!CFG?.rag?.pgUrl) {
        log.warn({ jobId }, "Postgres URL missing; skipping model registry persistence");
        return null;
    }
    const table = toNonEmptyString(registry.table);
    if (table === "") {
        log.warn({ jobId }, "Model registry table missing; skipping persistence");
        return null;
    }
    const schema = registry.schema === null ? null : toNonEmptyString(registry.schema);
    const columns = resolveRegistryColumns(registry.columns);
    const tableReference = schema
        ? `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`
        : quoteIdentifier(table);
    const sql = [
        "INSERT INTO",
        tableReference,
        "(",
        [
            quoteIdentifier(columns.name),
            quoteIdentifier(columns.status),
            quoteIdentifier(columns.jobId),
            quoteIdentifier(columns.fileId),
            quoteIdentifier(columns.metadata),
        ].join(", "),
        ") VALUES ($1, $2, $3, $4, $5)",
        "RETURNING",
        quoteIdentifier(columns.name),
        ";",
    ].join(" ");
    const metadata = {
        baseModel,
        finishedAt: job?.finished_at ?? null,
        resultFiles: Array.isArray(job?.result_files) ? job.result_files.slice() : undefined,
        trainingFileId,
    };
    await query(sql, [modelName, status, jobId, trainingFileId, metadata]);
    log.info({ jobId, model: modelName }, "Persisted fine-tuned model in registry");
    return true;
};

const pollFineTuneJob = async (client, jobId, { pollIntervalMs, log }) => {
    if (!toNonEmptyString(jobId)) {
        throw new Error("Fine-tune job id is required for polling.");
    }
    const interval = Number.isFinite(pollIntervalMs) && pollIntervalMs >= 0
        ? pollIntervalMs
        : DEFAULT_POLL_INTERVAL_MS;
    while (true) {
        const job = await client.fineTuning.jobs.retrieve(jobId);
        const status = toNonEmptyString(job?.status) || "unknown";
        if (status === "queued" || status === "running") {
            log.info({ jobId, status }, "Fine-tune job in progress");
            if (interval > 0) {
                await wait(interval);
            }
            continue;
        }
        if (!TERMINAL_STATUSES.has(status)) {
            log.warn({ jobId, status }, "Fine-tune job reported unexpected status; stopping polling");
        }
        return job;
    }
};

export const runFineTune = async (options = {}) => {
    const log = withContext(logger, { fn: "runFineTune" });
    const datasetPath = await resolveDatasetPath(options.datasetPath ?? options.file);
    const baseModel = resolveBaseModel(options.baseModel);
    const pollIntervalMs = Number.isFinite(options.pollIntervalMs) && options.pollIntervalMs >= 0
        ? options.pollIntervalMs
        : DEFAULT_POLL_INTERVAL_MS;

    log.info({ datasetPath, baseModel }, "Starting fine-tune pipeline");

    const client = createClient();
    log.info({ apiKeySource: CFG?.openaiApiKey ? "config" : "env" }, "Initialized OpenAI client for fine-tuning");

    const trainingFile = await client.files.create({
        file: createReadStream(datasetPath),
        purpose: "fine-tune",
    });
    const trainingFileId = toNonEmptyString(trainingFile?.id);
    if (!trainingFileId) {
        throw new Error("OpenAI did not return a training file id.");
    }
    log.info({ datasetPath, fileId: trainingFileId }, "Uploaded dataset for fine-tuning");

    const job = await client.fineTuning.jobs.create({
        training_file: trainingFileId,
        model: baseModel,
    });
    const jobId = toNonEmptyString(job?.id);
    if (!jobId) {
        throw new Error("OpenAI did not return a fine-tune job id.");
    }
    const initialStatus = toNonEmptyString(job?.status) || "unknown";
    log.info({ jobId, status: initialStatus, baseModel }, "Created fine-tune job");

    const finalJob = await pollFineTuneJob(client, jobId, { pollIntervalMs, log });
    const finalStatus = toNonEmptyString(finalJob?.status) || "unknown";
    const fineTunedModel = toNonEmptyString(finalJob?.fine_tuned_model);

    if (finalStatus !== "succeeded") {
        const errorMessage = toNonEmptyString(finalJob?.error?.message) || toNonEmptyString(finalJob?.error);
        log.error({ jobId, status: finalStatus, error: errorMessage }, "Fine-tune job failed");
        throw new Error(`Fine-tune job ${jobId} finished with status ${finalStatus}. ${errorMessage || ""}`.trim());
    }

    if (!fineTunedModel) {
        log.error({ jobId }, "Fine-tune job succeeded but no model name was returned");
        throw new Error(`Fine-tune job ${jobId} succeeded but no model name was returned.`);
    }

    await persistModelRecord({
        modelName: fineTunedModel,
        status: finalStatus,
        jobId,
        trainingFileId,
        baseModel,
        job: finalJob,
        log,
    });

    log.info({ jobId, model: fineTunedModel }, "Fine-tune job succeeded");

    return {
        jobId,
        status: finalStatus,
        model: fineTunedModel,
        trainingFileId,
    };
};

const parseCliOptions = () => {
    const [, , ...args] = process.argv;
    const options = {};
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        switch (arg) {
        case "--file":
        case "-f":
            options.datasetPath = args[index + 1];
            index += 1;
            break;
        case "--model":
        case "-m":
            options.baseModel = args[index + 1];
            index += 1;
            break;
        case "--poll":
            options.pollIntervalMs = Number.parseInt(args[index + 1] ?? "", 10);
            index += 1;
            break;
        default:
            if (!options.datasetPath) {
                options.datasetPath = arg;
            }
            break;
        }
    }
    return options;
};

const runAsCli = async () => {
    try {
        const options = parseCliOptions();
        await runFineTune(options);
    } catch (error) {
        const log = withContext(logger, { fn: "runFineTune.cli" });
        log.error({ err: error }, "Fine-tune script failed");
        process.exitCode = 1;
    }
};

const mainModulePath = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath && path.resolve(mainModulePath) === invokedPath) {
    await runAsCli();
}

export default runFineTune;
