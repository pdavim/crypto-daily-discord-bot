import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT_DIR = process.cwd();
const ROOTS = ["src", "tests", "bin"].map(entry => join(ROOT_DIR, entry));
const STYLE_TARGETS = [
    "src/alerts/decision.js",
    "src/alerts/variationMetrics.js",
    "src/minimumProfit.js",
    "src/portfolio",
    "src/trading/automation.js",
    "tests/quality",
].map(entry => join(ROOT_DIR, entry));
const DOUBLE_QUOTE = "\"";

const JS_FILES = collectFiles(ROOTS);
const STYLE_FILES = collectFiles(STYLE_TARGETS);

function collectFiles(targets) {
    const files = [];
    for (const target of targets) {
        gather(target, files);
    }
    return Array.from(new Set(files));
}

function gather(path, acc) {
    let stats;
    try {
        stats = statSync(path);
    } catch {
        return;
    }
    if (stats.isFile()) {
        if (path.endsWith(".js")) {
            acc.push(path);
        }
        return;
    }
    if (!stats.isDirectory()) {
        return;
    }
    for (const entry of readdirSync(path, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "coverage") {
            continue;
        }
        const fullPath = join(path, entry.name);
        if (entry.isDirectory()) {
            gather(fullPath, acc);
        } else if (entry.isFile() && entry.name.endsWith(".js")) {
            acc.push(fullPath);
        }
    }
}

function toRelative(file) {
    return file.startsWith(ROOT_DIR) ? file.slice(ROOT_DIR.length + 1) : file;
}

describe("code style compliance", () => {
    it("uses double quotes for module specifiers", () => {
        const offenders = [];
        const importRegex = /(import\s+[^;]+?\s+from\s+)(['"])([^'"\n]+)\2/g;
        const exportRegex = /(export\s+[^;]+?\s+from\s+)(['"])([^'"\n]+)\2/g;
        const dynamicImportRegex = /(import\s*\(\s*)(['"])([^'"\n]+)\2(\s*\))/g;
        for (const file of JS_FILES) {
            const source = readFileSync(file, "utf8");
            for (const match of source.matchAll(importRegex)) {
                if (match[2] !== DOUBLE_QUOTE) {
                    offenders.push(`${toRelative(file)}: import from ${match[3]}`);
                }
            }
            for (const match of source.matchAll(exportRegex)) {
                if (match[2] !== DOUBLE_QUOTE) {
                    offenders.push(`${toRelative(file)}: export from ${match[3]}`);
                }
            }
            for (const match of source.matchAll(dynamicImportRegex)) {
                if (match[2] !== DOUBLE_QUOTE) {
                    offenders.push(`${toRelative(file)}: dynamic import ${match[3]}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it("avoids CommonJS module patterns", () => {
        const offenders = [];
        for (const file of JS_FILES) {
            const source = readFileSync(file, "utf8");
            if (/module\.exports/.test(source) || /\brequire\s*\(/.test(source)) {
                offenders.push(toRelative(file));
            }
        }
        expect(offenders).toEqual([]);
    });

    it("uses four-space indentation in modernized modules", () => {
        const offenders = [];
        for (const file of STYLE_FILES) {
            const source = readFileSync(file, "utf8");
            const lines = source.split(/\r?\n/);
            lines.forEach((line, index) => {
                if (/^\s*$/.test(line)) {
                    return;
                }
                const match = line.match(/^( +)(\S)/);
                if (!match) {
                    return;
                }
                const [, spaces, nextChar] = match;
                if (nextChar === "*" || nextChar === "@") {
                    return;
                }
                if (spaces.length % 4 !== 0) {
                    offenders.push(`${toRelative(file)}:${index + 1}`);
                }
            });
        }
        expect(offenders).toEqual([]);
    });
});
