import fs from "fs";
import path from "path";

const DATA_DIR = path.resolve(process.cwd(), "data");
const STORE_FILE = process.env.RUN_SIGNATURES_FILE
    ? path.resolve(process.env.RUN_SIGNATURES_FILE)
    : path.join(DATA_DIR, "run-signatures.json");
const STORE_DIR = path.dirname(STORE_FILE);

function createDefaultStore() {
    return {
        signatures: {},
        alertHashes: {},
        forecasts: {},
    };
}

function normalizeStore(raw) {
    const base = createDefaultStore();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return base;
    }

    if (raw.signatures && typeof raw.signatures === "object" && !Array.isArray(raw.signatures)) {
        base.signatures = { ...raw.signatures };
    } else {
        for (const [key, value] of Object.entries(raw)) {
            if (key === "alertHashes" || key === "forecasts") continue;
            base.signatures[key] = value;
        }
    }

    if (raw.alertHashes && typeof raw.alertHashes === "object" && !Array.isArray(raw.alertHashes)) {
        for (const [scope, hashes] of Object.entries(raw.alertHashes)) {
            if (hashes && typeof hashes === "object" && !Array.isArray(hashes)) {
                base.alertHashes[scope] = { ...hashes };
            }
        }
    }

    if (raw.forecasts && typeof raw.forecasts === "object" && !Array.isArray(raw.forecasts)) {
        for (const [assetKey, timeframes] of Object.entries(raw.forecasts)) {
            if (!timeframes || typeof timeframes !== "object" || Array.isArray(timeframes)) {
                continue;
            }
            const snapshot = {};
            for (const [tf, forecast] of Object.entries(timeframes)) {
                if (forecast && typeof forecast === "object" && !Array.isArray(forecast)) {
                    snapshot[tf] = { ...forecast };
                }
            }
            if (Object.keys(snapshot).length > 0) {
                base.forecasts[assetKey] = snapshot;
            }
        }
    }

    return base;
}

let store = createDefaultStore();
try {
    if (fs.existsSync(STORE_FILE)) {
        const txt = fs.readFileSync(STORE_FILE, "utf8");
        const parsed = JSON.parse(txt || "{}");
        store = normalizeStore(parsed);
    } else {
        fs.mkdirSync(STORE_DIR, { recursive: true });
    }
} catch (e) {
    store = createDefaultStore();
}

function ensureScope(scope) {
    const key = scope || "default";
    if (!store.alertHashes[key] || typeof store.alertHashes[key] !== "object") {
        store.alertHashes[key] = {};
    }
    return key;
}

function ensureForecastAsset(assetKey) {
    if (!assetKey) {
        return null;
    }
    if (!store.forecasts[assetKey] || typeof store.forecasts[assetKey] !== "object") {
        store.forecasts[assetKey] = {};
    }
    return assetKey;
}

/**
 * Retrieves the stored signature for an asset/timeframe combination.
 * @param {string} key - Signature key.
 * @returns {*} Stored signature value or undefined when not set.
 */
export function getSignature(key) {
    return store.signatures[key];
}

/**
 * Updates the signature associated with a key.
 * @param {string} key - Signature key.
 * @param {*} value - Value to store.
 * @returns {void}
 */
export function updateSignature(key, value) {
    store.signatures[key] = value;
}

/**
 * Retrieves the last alert hash for a scope/key pair.
 * @param {string} scope - Alert scope identifier.
 * @param {string} [key='default'] - Alert key within the scope.
 * @returns {string|undefined} Stored hash value.
 */
export function getAlertHash(scope, key = 'default') {
    return store.alertHashes?.[scope]?.[key];
}

/**
 * Stores or clears an alert hash for deduplication.
 * @param {string} scope - Alert scope identifier.
 * @param {string} key - Alert key within the scope.
 * @param {string|null|undefined} hash - Hash value to store; removes entry when nullish.
 * @returns {void}
 */
export function updateAlertHash(scope, key, hash) {
    const scopeKey = ensureScope(scope);
    const entryKey = key ?? "default";
    if (hash == null) {
        delete store.alertHashes[scopeKey][entryKey];
        if (Object.keys(store.alertHashes[scopeKey]).length === 0) {
            delete store.alertHashes[scopeKey];
        }
        return;
    }
    store.alertHashes[scopeKey][entryKey] = hash;
}

/**
 * Clears cached alert hashes for a specific scope or all scopes.
 * @param {string} [scope] - Scope identifier to reset.
 * @returns {void}
 */
export function resetAlertHashes(scope) {
    if (scope) {
        delete store.alertHashes[scope];
    } else {
        store.alertHashes = {};
    }
}

/**
 * Updates the cached forecast snapshot for an asset/timeframe pair.
 * @param {string} assetKey - Asset identifier.
 * @param {string} timeframe - Timeframe label.
 * @param {object|null|undefined} forecast - Forecast payload to persist; removes entry when nullish.
 * @returns {void}
 */
export function updateForecastSnapshot(assetKey, timeframe, forecast) {
    if (!assetKey || !timeframe) {
        return;
    }
    if (forecast == null) {
        if (store.forecasts?.[assetKey]) {
            delete store.forecasts[assetKey][timeframe];
            if (Object.keys(store.forecasts[assetKey]).length === 0) {
                delete store.forecasts[assetKey];
            }
        }
        return;
    }
    const scope = ensureForecastAsset(assetKey);
    if (!scope) {
        return;
    }
    store.forecasts[scope][timeframe] = { ...forecast };
}

/**
 * Retrieves a shallow clone of the cached forecasts for an asset.
 * @param {string} assetKey - Asset identifier.
 * @returns {Record<string, object>} Object keyed by timeframe containing the latest forecast snapshots.
 */
export function getForecastSnapshot(assetKey) {
    if (!assetKey) {
        return {};
    }
    const entry = store.forecasts?.[assetKey];
    if (!entry || typeof entry !== "object") {
        return {};
    }
    const clone = {};
    for (const [timeframe, forecast] of Object.entries(entry)) {
        if (forecast && typeof forecast === "object" && !Array.isArray(forecast)) {
            clone[timeframe] = { ...forecast };
        }
    }
    return clone;
}

/**
 * Persists the current store state to disk.
 * @returns {void}
 */
export function saveStore() {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}
