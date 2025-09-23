#!/usr/bin/env node

import { promises as fs } from "fs";
import path from "path";

const REPORTS_DIR = path.resolve("reports");
const MAX_AGE_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

async function cleanupReports() {
    let entries;
    try {
        entries = await fs.readdir(REPORTS_DIR, { withFileTypes: true });
    } catch (err) {
        if (err?.code === "ENOENT") {
            return;
        }
        throw err;
    }

    const now = Date.now();
    const removed = [];
    for (const entry of entries) {
        if (!entry.isFile()) {
            continue;
        }
        const filePath = path.join(REPORTS_DIR, entry.name);
        let stats;
        try {
            stats = await fs.stat(filePath);
        } catch (err) {
            if (err?.code === "ENOENT") {
                continue;
            }
            throw err;
        }

        if (now - stats.mtimeMs > MAX_AGE_DAYS * MS_PER_DAY) {
            await fs.unlink(filePath);
            removed.push(filePath);
        }
    }

    if (removed.length > 0) {
        console.log(`Removed ${removed.length} report(s):`);
        for (const file of removed) {
            console.log(` - ${file}`);
        }
    }
}

cleanupReports().catch(err => {
    console.error("Failed to cleanup reports", err);
    process.exitCode = 1;
});
