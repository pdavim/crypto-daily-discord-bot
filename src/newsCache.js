import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { logger, withContext } from "./logger.js";

const CACHE_PATH = new URL("../data/news-item-cache.json", import.meta.url);
const ENTRY_TTL_MS = 24 * 60 * 60 * 1000;

let cache = {};
let cacheLoaded = false;
let loadPromise;

function hashNewsItem(title, url) {
    const normalizedTitle = (title ?? "").trim().toLowerCase();
    const normalizedUrl = (url ?? "").trim();
    if (!normalizedTitle && !normalizedUrl) {
        return null;
    }
    return createHash("sha256").update(`${normalizedTitle}||${normalizedUrl}`).digest("hex");
}

async function persistCache(log) {
    try {
        await writeFile(CACHE_PATH, JSON.stringify(cache, null, 2));
    } catch (err) {
        log.error({ fn: "persistNewsItemCache", err }, "Failed to persist news item cache");
    }
}

async function ensureCacheLoaded(log = withContext(logger)) {
    if (cacheLoaded) {
        return;
    }
    if (!loadPromise) {
        loadPromise = (async () => {
            try {
                const raw = await readFile(CACHE_PATH, "utf8");
                const parsed = JSON.parse(raw);
                cache = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
            } catch (err) {
                if (err?.code !== "ENOENT") {
                    log.warn({ fn: "ensureNewsItemCacheLoaded", err }, "Failed to load news item cache; starting empty");
                }
                cache = {};
            }
            cacheLoaded = true;
        })();
    }
    await loadPromise;
}

function pruneExpiredEntries(now) {
    const cutoff = now - ENTRY_TTL_MS;
    let changed = false;
    for (const [hash, timestamp] of Object.entries(cache)) {
        if (typeof timestamp !== "number" || timestamp < cutoff) {
            delete cache[hash];
            changed = true;
        }
    }
    return changed;
}

/**
 * Filters out news items that were recently processed.
 * @param {Array<Object>} items - Candidate news items.
 * @param {number} [now=Date.now()] - Timestamp used as reference for cache TTL.
 * @param {*} [log=withContext(logger)] - Logger instance for diagnostics.
 * @returns {Promise} Items that have not been seen recently.
 */
export async function filterFreshNewsItems(items, now = Date.now(), log = withContext(logger)) {
    await ensureCacheLoaded(log);
    const effectiveNow = Number.isFinite(now) ? now : Date.now();
    const changed = pruneExpiredEntries(effectiveNow);
    const freshItems = [];

    for (const item of items ?? []) {
        if (!item) {
            continue;
        }
        const hash = hashNewsItem(item.title, item.url);
        if (!hash) {
            freshItems.push(item);
            continue;
        }
        const timestamp = cache[hash];
        if (typeof timestamp === "number" && effectiveNow - timestamp <= ENTRY_TTL_MS) {
            continue;
        }
        freshItems.push(item);
    }

    if (changed) {
        await persistCache(log);
    }

    return freshItems;
}

/**
 * Records news items in the cache so they are not processed again within the TTL.
 * @param {Array<Object>} items - News items to mark as seen.
 * @param {number} [now=Date.now()] - Timestamp used for the cache entries.
 * @param {*} [log=withContext(logger)] - Logger instance for diagnostics.
 * @returns {Promise} Resolves when the cache has been updated.
 */
export async function markNewsItemsAsSeen(items, now = Date.now(), log = withContext(logger)) {
    await ensureCacheLoaded(log);
    const effectiveNow = Number.isFinite(now) ? now : Date.now();
    let changed = pruneExpiredEntries(effectiveNow);

    for (const item of items ?? []) {
        if (!item) {
            continue;
        }
        const hash = hashNewsItem(item.title, item.url);
        if (!hash) {
            continue;
        }
        if (cache[hash] !== effectiveNow) {
            cache[hash] = effectiveNow;
            changed = true;
        }
    }

    if (changed) {
        await persistCache(log);
    }
}
