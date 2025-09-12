import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

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
    fs.mkdirSync(path.dirname(ALERTS_FILE), { recursive: true });
    fs.writeFileSync(ALERTS_FILE, JSON.stringify(cache, null, 2));
}

export function buildHash(text) {
    return crypto.createHash('sha256').update(text).digest('hex');
}

export function shouldSend(hash, windowMs) {
    const now = Date.now();
    cache = cache.filter(entry => now - entry.time <= windowMs);
    if (cache.some(entry => entry.hash === hash)) {
        return false;
    }
    cache.push({ hash, time: now });
    persist();
    return true;
}
