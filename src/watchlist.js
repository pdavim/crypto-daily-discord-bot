import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const WATCH_FILE = process.env.WATCHLIST_FILE
  ? path.resolve(process.env.WATCHLIST_FILE)
  : path.join(DATA_DIR, 'watchlist.json');

function sanitizeAssets(assets) {
  if (!Array.isArray(assets)) return [];
  const seen = new Set();
  const cleaned = [];
  for (const asset of assets) {
    if (typeof asset !== 'string') continue;
    if (seen.has(asset)) continue;
    seen.add(asset);
    cleaned.push(asset);
  }
  return cleaned;
}

let list = {};
let needsMigration = false;
try {
  if (fs.existsSync(WATCH_FILE)) {
    const txt = fs.readFileSync(WATCH_FILE, 'utf8');
    const parsed = JSON.parse(txt || '{}');
    if (Array.isArray(parsed)) {
      const assets = sanitizeAssets(parsed);
      if (assets.length) {
        list = { __legacy__: assets };
        needsMigration = true;
      }
    } else if (parsed && typeof parsed === 'object') {
      const entries = Object.entries(parsed);
      const result = {};
      for (const [key, value] of entries) {
        const assets = sanitizeAssets(value);
        if (assets.length) {
          result[key] = assets;
        }
      }
      list = result;
    }
  } else {
    fs.mkdirSync(path.dirname(WATCH_FILE), { recursive: true });
  }
} catch (e) {
  list = {};
}

function persist() {
  const dir = path.dirname(WATCH_FILE);
  fs.mkdirSync(dir, { recursive: true });
  const hasAssets = Object.values(list).some(assets => assets.length);
  if (!hasAssets) {
    if (fs.existsSync(WATCH_FILE)) {
      fs.rmSync(WATCH_FILE);
    }
    return;
  }
  fs.writeFileSync(WATCH_FILE, JSON.stringify(list, null, 2));
}

if (needsMigration) {
  try {
    persist();
  } catch (e) {
    // ignore migration persistence errors at startup
  }
}

function ensureUser(userId) {
  if (!list[userId]) {
    list[userId] = [];
  }
}

/**
 * Retrieves the watchlist for a given user or the aggregated watchlist.
 * @param {string} [userId] - User identifier; when omitted returns the merged list.
 * @returns {Array} Array of tracked asset tickers.
 */
export function getWatchlist(userId) {
  if (userId) {
    return list[userId] ? list[userId].slice() : [];
  }
  const combined = new Set();
  for (const assets of Object.values(list)) {
    for (const asset of assets) combined.add(asset);
  }
  return Array.from(combined);
}

/**
 * Adds an asset to a user's watchlist if it is not already present.
 * @param {string} userId - User identifier.
 * @param {string} asset - Asset ticker to add.
 * @returns {boolean} True when the asset was inserted.
 */
export function addAssetToWatch(userId, asset) {
  if (!userId || typeof asset !== 'string') return false;
  ensureUser(userId);
  const assets = list[userId];
  if (!assets.includes(asset)) {
    assets.push(asset);
    persist();
    return true;
  }
  return false;
}

/**
 * Removes an asset from a user's watchlist.
 * @param {string} userId - User identifier.
 * @param {string} asset - Asset ticker to remove.
 * @returns {boolean} True when the asset was removed.
 */
export function removeAssetFromWatch(userId, asset) {
  if (!userId || !list[userId]) return false;
  const assets = list[userId];
  const idx = assets.indexOf(asset);
  if (idx !== -1) {
    assets.splice(idx, 1);
    if (!assets.length) {
      delete list[userId];
    }
    persist();
    return true;
  }
  return false;
}
