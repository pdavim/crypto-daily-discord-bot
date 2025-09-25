import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const DIRECTORIES = [
    { dir: "data", allowedFiles: [".gitkeep"], allowedDirs: [] },
    { dir: "charts", allowedFiles: [".gitkeep"], allowedDirs: [] },
    { dir: "reports", allowedFiles: [".gitkeep"], allowedDirs: ["charts"] },
    { dir: "reports/charts", allowedFiles: [".gitkeep"], allowedDirs: [] },
];

describe("generated directories remain clean", () => {
    for (const { dir, allowedFiles, allowedDirs } of DIRECTORIES) {
        it(`${dir} only contains tracked placeholders`, () => {
            const entries = safeReadDir(dir);
            const unexpected = entries.filter(entry => {
                if (entry === "." || entry === "..") {
                    return false;
                }
                const fullPath = resolve(dir, entry);
                const stats = statSync(fullPath);
                if (stats.isDirectory()) {
                    return !allowedDirs.includes(entry);
                }
                return !allowedFiles.includes(entry);
            });
            expect(unexpected).toEqual([]);
        });
    }
});

function safeReadDir(dir) {
    try {
        return readdirSync(dir);
    } catch (error) {
        throw new Error(`Expected directory ${dir} to exist.`, { cause: error });
    }
}
