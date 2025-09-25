import fs from "fs";
import path from "path";
import crypto from "crypto";

const DATA_DIR = path.resolve(process.cwd(), 'data');
const ALERTS_FILE = process.env.ALERTS_CACHE_FILE ? path.resolve(process.env.ALERTS_CACHE_FILE) : path.join(DATA_DIR, 'alerts.json');

let cache = [];
try {
    if (fs.existsSync(ALERTS_FILE)) {
        const txt = fs.readFileSync(ALERTS_FILE, 'utf8');
        cache = JSON.parse(txt || '[]');
    } else {
        fs.mkdirSync(path.dirname(ALERTS_FILE), { recursive: true });
    }
} catch (e) {
    cache = [];
}

function persist() {
    const dir = path.dirname(ALERTS_FILE);
    fs.mkdirSync(dir, { recursive: true });
    if (!cache.length) {
        if (fs.existsSync(ALERTS_FILE)) {
            fs.rmSync(ALERTS_FILE);
        }
        return;
    }
    fs.writeFileSync(ALERTS_FILE, JSON.stringify(cache, null, 2));
}

/**
 * Generates a stable SHA-256 hash for alert content.
 * @param {string} text - Alert payload to hash.
 * @returns {string} Hex encoded hash string.
 */
export function buildHash(text) {
    return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * Determines whether a new alert should be sent or suppressed due to duplication.
 * @param {{asset: string, tf: string, hash: string}} params - Alert identity parameters.
 * @param {number} windowMs - Duration in milliseconds for deduplication.
 * @returns {boolean} True when the alert should be dispatched.
 */
export function shouldSend({ asset, tf, hash }, windowMs) {
    const now = Date.now();
    cache = cache.filter(entry => now - entry.time <= windowMs);
    if (cache.some(entry => entry.hash === hash && entry.asset === asset && entry.tf === tf)) {
        return false;
    }
    cache.push({ asset, tf, hash, time: now });
    persist();
    return true;
}

/**
 * Removes cached alerts older than the provided time window.
 * @param {number} ms - Milliseconds defining the retention window.
 * @returns {void}
 */
export function pruneOlderThan(ms) {
    const cutoff = Date.now() - ms;
    const before = cache.length;
    cache = cache.filter(entry => entry.time >= cutoff);
    if (cache.length !== before) {
        persist();
    }
}
