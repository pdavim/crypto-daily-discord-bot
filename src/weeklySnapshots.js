import { promises as fs } from "node:fs/promises";
import path from "node:path";

const WEEKLY_SNAPSHOT_FILE = path.resolve("reports/weekly.json");

function normalizeEntries(raw) {
    if (!raw) {
        return [];
    }
    if (Array.isArray(raw)) {
        return raw.filter(entry => entry && typeof entry === 'object');
    }
    if (typeof raw === 'object' && Array.isArray(raw.entries)) {
        return raw.entries.filter(entry => entry && typeof entry === 'object');
    }
    return [];
}

async function readFileSafe(filePath) {
    try {
        const txt = await fs.readFile(filePath, "utf8");
        if (!txt) {
            return { entries: [] };
        }
        const parsed = JSON.parse(txt);
        const entries = normalizeEntries(parsed);
        return { entries };
    } catch (error) {
        if (error.code === 'ENOENT') {
            return { entries: [] };
        }
        throw error;
    }
}

function sortEntries(entries) {
    return entries.slice().sort((a, b) => {
        const ta = Date.parse(a?.generatedAt ?? 0) || 0;
        const tb = Date.parse(b?.generatedAt ?? 0) || 0;
        return ta - tb;
    });
}

/**
 * Loads stored weekly snapshot entries sorted by generation time.
 * @returns {Promise} Weekly snapshot entries.
 */
export async function loadWeeklySnapshots() {
    const data = await readFileSafe(WEEKLY_SNAPSHOT_FILE);
    return sortEntries(data.entries);
}

/**
 * Persists a weekly snapshot entry, replacing any existing entry for the same signature.
 * @param {Object} entry - Snapshot data to store.
 * @returns {Promise} Absolute path to the snapshot file.
 */
export async function saveWeeklySnapshot(entry) {
    if (!entry || typeof entry !== 'object') {
        throw new TypeError('Weekly snapshot entry must be an object.');
    }
    await fs.mkdir(path.dirname(WEEKLY_SNAPSHOT_FILE), { recursive: true });
    const data = await readFileSafe(WEEKLY_SNAPSHOT_FILE);
    const entries = data.entries;
    const weekSignature = entry.weekSignature ?? entry.signature ?? null;
    const existingIndex = weekSignature == null
        ? -1
        : entries.findIndex(item => item?.weekSignature === weekSignature);
    if (existingIndex >= 0) {
        entries[existingIndex] = { ...entries[existingIndex], ...entry };
    } else {
        entries.push(entry);
    }
    const sorted = sortEntries(entries);
    const payload = { entries: sorted };
    await fs.writeFile(WEEKLY_SNAPSHOT_FILE, JSON.stringify(payload, null, 2));
    return WEEKLY_SNAPSHOT_FILE;
}

export { WEEKLY_SNAPSHOT_FILE };
