#!/usr/bin/env node
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { listApprovedExamples } from "../src/feedback.js";

const DEFAULT_OUTPUT_NAME = "fine-tune.jsonl";
const SNAPSHOT_SECTION_TITLE = "Snapshots agregados:";
const INDICATOR_SECTION_TITLE = "Indicadores agregados:";

const isHttpLike = (value) => {
    if (typeof value !== "string") {
        return false;
    }
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
};

const toAbsolutePath = (baseDir, relativePath) => {
    if (typeof relativePath !== "string" || relativePath.trim() === "") {
        return null;
    }
    const normalized = relativePath.trim();
    if (isHttpLike(normalized) || normalized.startsWith("data:")) {
        return null;
    }
    return path.resolve(baseDir, normalized);
};

const readJsonIfAvailable = async (absolutePath) => {
    if (!absolutePath) {
        return null;
    }
    try {
        const stats = await fs.stat(absolutePath);
        if (!stats.isFile()) {
            return null;
        }
        const raw = await fs.readFile(absolutePath, "utf8");
        const trimmed = raw.trim();
        if (trimmed === "") {
            return null;
        }
        return JSON.parse(trimmed);
    } catch {
        return null;
    }
};

const collectObjectsByKey = (value, key) => {
    const results = [];
    if (!value || typeof value !== "object") {
        return results;
    }
    const stack = [value];
    while (stack.length > 0) {
        const current = stack.pop();
        if (!current || typeof current !== "object") {
            continue;
        }
        if (Object.prototype.hasOwnProperty.call(current, key)) {
            const entry = current[key];
            if (entry && typeof entry === "object") {
                results.push(entry);
            }
        }
        for (const nested of Object.values(current)) {
            if (nested && typeof nested === "object") {
                stack.push(nested);
            }
        }
    }
    return results;
};

const isPlainObject = (value) => value && typeof value === "object" && !Array.isArray(value);

const flattenObject = (value, prefix = "") => {
    const entries = [];
    if (!isPlainObject(value)) {
        return entries;
    }
    for (const [key, child] of Object.entries(value)) {
        const pathKey = prefix ? `${prefix}.${key}` : key;
        if (child == null) {
            continue;
        }
        if (isPlainObject(child)) {
            entries.push(...flattenObject(child, pathKey));
            continue;
        }
        if (Array.isArray(child)) {
            const printable = child
                .map((item) => {
                    if (item == null) {
                        return null;
                    }
                    if (typeof item === "number") {
                        return formatNumber(item);
                    }
                    if (typeof item === "string") {
                        const trimmed = item.trim();
                        return trimmed === "" ? null : trimmed;
                    }
                    if (typeof item === "boolean") {
                        return item ? "true" : "false";
                    }
                    return null;
                })
                .filter(Boolean);
            if (printable.length > 0) {
                entries.push([pathKey, printable.join(", ")]);
            }
            continue;
        }
        if (typeof child === "number") {
            entries.push([pathKey, formatNumber(child)]);
            continue;
        }
        if (typeof child === "boolean") {
            entries.push([pathKey, child ? "true" : "false"]);
            continue;
        }
        if (typeof child === "string") {
            const trimmed = child.trim();
            if (trimmed !== "") {
                entries.push([pathKey, trimmed]);
            }
        }
    }
    return entries;
};

const formatNumber = (value) => {
    if (!Number.isFinite(value)) {
        return String(value);
    }
    if (Math.abs(value) >= 100 || Number.isInteger(value)) {
        return value.toString();
    }
    const fixed = value.toFixed(4);
    return fixed.replace(/\.0+$/, "").replace(/0+$/, "");
};

const formatSnapshotMap = (payload) => {
    const lines = [];
    if (Array.isArray(payload)) {
        payload.forEach((entry, index) => {
            const label = typeof entry?.timeframe === "string" && entry.timeframe.trim() !== ""
                ? entry.timeframe.trim()
                : `item${index + 1}`;
            lines.push(...formatSnapshotEntry(label, entry));
        });
        return lines;
    }
    if (isPlainObject(payload)) {
        for (const [label, entry] of Object.entries(payload)) {
            lines.push(...formatSnapshotEntry(label, entry));
        }
    }
    return lines;
};

const formatSnapshotEntry = (label, snapshot) => {
    if (!isPlainObject(snapshot)) {
        return [];
    }
    const metrics = [];
    if (isPlainObject(snapshot.kpis)) {
        const kpisEntries = flattenObject(snapshot.kpis);
        for (const [key, value] of kpisEntries) {
            const normalizedKey = key.startsWith("kpis.") ? key.slice(5) : key;
            metrics.push(`${normalizedKey}=${value}`);
        }
    }
    const remaining = { ...snapshot };
    delete remaining.kpis;
    const otherEntries = flattenObject(remaining);
    for (const [key, value] of otherEntries) {
        metrics.push(`${key}=${value}`);
    }
    if (metrics.length === 0) {
        return [];
    }
    return [`- ${label}: ${metrics.join(", ")}`];
};

const formatIndicatorMap = (payload) => {
    const lines = [];
    if (Array.isArray(payload)) {
        payload.forEach((entry, index) => {
            if (!isPlainObject(entry)) {
                return;
            }
            const label = typeof entry?.name === "string" && entry.name.trim() !== ""
                ? entry.name.trim()
                : `item${index + 1}`;
            const values = flattenObject(entry.value ?? entry);
            const content = values.length > 0
                ? values.map(([key, value]) => `${key}: ${value}`).join(", ")
                : null;
            if (content) {
                lines.push(`- ${label}: ${content}`);
            }
        });
        return lines;
    }
    if (isPlainObject(payload)) {
        const entries = flattenObject(payload);
        for (const [key, value] of entries) {
            lines.push(`- ${key}: ${value}`);
        }
    }
    return lines;
};

const collectContextFromSources = async (sources, baseDir) => {
    const snapshotLines = [];
    const indicatorLines = [];
    const references = [];
    const seenRefs = new Set();

    if (!Array.isArray(sources)) {
        sources = [];
    }

    for (const rawSource of sources) {
        if (typeof rawSource !== "string") {
            continue;
        }
        const trimmed = rawSource.trim();
        if (trimmed === "") {
            continue;
        }
        if (!seenRefs.has(trimmed)) {
            seenRefs.add(trimmed);
            references.push(trimmed);
        }
        const absolutePath = toAbsolutePath(baseDir, trimmed);
        if (!absolutePath) {
            continue;
        }
        const ext = path.extname(absolutePath).toLowerCase();
        if (ext !== ".json" && ext !== ".json5" && ext !== ".jsonl") {
            continue;
        }
        const content = await readJsonIfAvailable(absolutePath);
        if (!content) {
            continue;
        }
        const snapshotsPayloads = collectObjectsByKey(content, "snapshots");
        for (const snapshots of snapshotsPayloads) {
            snapshotLines.push(...formatSnapshotMap(snapshots));
        }
        const indicatorsPayloads = collectObjectsByKey(content, "indicators");
        for (const indicators of indicatorsPayloads) {
            indicatorLines.push(...formatIndicatorMap(indicators));
        }
    }

    const contextSections = [];
    if (snapshotLines.length > 0) {
        contextSections.push([SNAPSHOT_SECTION_TITLE, ...snapshotLines].join("\n"));
    }
    if (indicatorLines.length > 0) {
        contextSections.push([INDICATOR_SECTION_TITLE, ...indicatorLines].join("\n"));
    }

    return { contextSections, references };
};

const buildPrompt = (question, contextSections, references) => {
    const parts = [`Pergunta:\n${question}`];
    for (const section of contextSections) {
        if (section && section.trim() !== "") {
            parts.push(section);
        }
    }
    if (references.length > 0) {
        const lines = references.map((reference, index) => `[${index + 1}] ${reference}`);
        parts.push("Fontes:");
        parts.push(lines.join("\n"));
    }
    return parts.join("\n\n");
};

export const buildFineTuneDataset = async (options = {}) => {
    const baseDir = options.baseDir ? path.resolve(options.baseDir) : process.cwd();
    const outputPath = options.outputPath
        ? path.resolve(options.outputPath)
        : path.join(baseDir, "data", DEFAULT_OUTPUT_NAME);

    const examples = await listApprovedExamples();
    const dataset = [];

    for (const example of examples) {
        const question = typeof example?.question === "string" ? example.question.trim() : "";
        const answer = typeof example?.answer === "string" ? example.answer.trim() : "";
        if (question === "" || answer === "") {
            continue;
        }
        const { contextSections, references } = await collectContextFromSources(example?.sources ?? [], baseDir);
        const prompt = buildPrompt(question, contextSections, references);
        dataset.push({ prompt, completion: answer });
    }

    const outputDir = path.dirname(outputPath);
    await fs.mkdir(outputDir, { recursive: true });
    const lines = dataset.map((entry) => JSON.stringify(entry));
    let content = lines.join("\n");
    if (content !== "") {
        content += "\n";
    }
    await fs.writeFile(outputPath, content, "utf8");
    return dataset;
};

const runAsScript = async () => {
    try {
        const dataset = await buildFineTuneDataset();
        const output = path.join(process.cwd(), "data", DEFAULT_OUTPUT_NAME);
        console.log(`✅ Dataset gerado com ${dataset.length} exemplos em ${output}`);
    } catch (error) {
        console.error('❌ Falha ao gerar dataset de fine-tuning:', error);
        process.exitCode = 1;
    }
};

const mainModulePath = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1] ? path.normalize(process.argv[1]) : null;
if (invokedPath && path.normalize(mainModulePath) === invokedPath) {
    await runAsScript();
}
