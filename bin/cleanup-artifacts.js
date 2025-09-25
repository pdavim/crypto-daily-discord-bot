#!/usr/bin/env node

import { promises as fs } from "fs";
import path from "path";

const DIRECTORIES = [
    { path: "logs", ensureGitkeep: false },
    { path: "reports", ensureGitkeep: true },
    { path: "charts", ensureGitkeep: true },
    { path: "coverage", ensureGitkeep: false }
];

const PRESERVE_SUBDIRECTORIES = new Map([
    ["reports", ["charts"]]
]);

const KEEP_FILES = new Set([".gitkeep"]);

async function ensureDirectory(target, ensureGitkeep) {
    await fs.mkdir(target, { recursive: true });
    if (!ensureGitkeep) {
        return;
    }

    const gitkeepPath = path.join(target, ".gitkeep");
    try {
        await fs.access(gitkeepPath);
    } catch (error) {
        if (error?.code === "ENOENT") {
            await fs.writeFile(gitkeepPath, "");
            return;
        }
        throw error;
    }
}

async function ensureSubdirectories(target, directories) {
    if (!directories?.length) {
        return;
    }

    for (const subdirectory of directories) {
        const subdirectoryPath = path.join(target, subdirectory);
        await ensureDirectory(subdirectoryPath, true);
    }
}

async function purgeDirectory(target, ensureGitkeep, subdirectories) {
    let entries;
    try {
        entries = await fs.readdir(target, { withFileTypes: true });
    } catch (error) {
        if (error?.code === "ENOENT") {
            await ensureDirectory(target, ensureGitkeep);
            await ensureSubdirectories(target, subdirectories);
            return { removed: 0, created: true };
        }
        throw error;
    }

    let removed = 0;
    for (const entry of entries) {
        if (KEEP_FILES.has(entry.name)) {
            continue;
        }

        const entryPath = path.join(target, entry.name);
        await fs.rm(entryPath, { recursive: true, force: true });
        removed += 1;
    }

    await ensureDirectory(target, ensureGitkeep);
    await ensureSubdirectories(target, subdirectories);

    return { removed, created: false };
}

async function cleanupArtifacts() {
    const summary = [];

    for (const { path: directory, ensureGitkeep } of DIRECTORIES) {
        const absolute = path.resolve(directory);
        const result = await purgeDirectory(absolute, ensureGitkeep, PRESERVE_SUBDIRECTORIES.get(directory));
        if (result.created) {
            summary.push(`${directory}: criado`);
            continue;
        }
        summary.push(`${directory}: ${result.removed} entr${result.removed === 1 ? "ada" : "adas"} removid${result.removed === 1 ? "a" : "as"}`);
    }

    if (summary.length > 0) {
        console.log('Limpeza concluída:\n' + summary.map(line => ` - ${line}`).join("\n"));
    }
}

cleanupArtifacts().catch(error => {
    console.error('Falha ao limpar artefatos', error);
    process.exitCode = 1;
});
