import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_FILE = process.env.RUN_SIGNATURES_FILE
  ? path.resolve(process.env.RUN_SIGNATURES_FILE)
  : path.join(DATA_DIR, 'run-signatures.json');
const STORE_DIR = path.dirname(STORE_FILE);

function createDefaultStore() {
  return {
    signatures: {},
    alertHashes: {}
  };
}

function normalizeStore(raw) {
  const base = createDefaultStore();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return base;
  }

  if (raw.signatures && typeof raw.signatures === 'object' && !Array.isArray(raw.signatures)) {
    base.signatures = { ...raw.signatures };
  } else {
    for (const [key, value] of Object.entries(raw)) {
      if (key === 'alertHashes') continue;
      base.signatures[key] = value;
    }
  }

  if (raw.alertHashes && typeof raw.alertHashes === 'object' && !Array.isArray(raw.alertHashes)) {
    for (const [scope, hashes] of Object.entries(raw.alertHashes)) {
      if (hashes && typeof hashes === 'object' && !Array.isArray(hashes)) {
        base.alertHashes[scope] = { ...hashes };
      }
    }
  }

  return base;
}

let store = createDefaultStore();
try {
  if (fs.existsSync(STORE_FILE)) {
    const txt = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(txt || '{}');
    store = normalizeStore(parsed);
  } else {
    fs.mkdirSync(STORE_DIR, { recursive: true });
  }
} catch (e) {
  store = createDefaultStore();
}

function ensureScope(scope) {
  const key = scope || 'default';
  if (!store.alertHashes[key] || typeof store.alertHashes[key] !== 'object') {
    store.alertHashes[key] = {};
  }
  return key;
}

export function getSignature(key) {
  return store.signatures[key];
}

export function updateSignature(key, value) {
  store.signatures[key] = value;
}

export function getAlertHash(scope, key = 'default') {
  return store.alertHashes?.[scope]?.[key];
}

export function updateAlertHash(scope, key, hash) {
  const scopeKey = ensureScope(scope);
  const entryKey = key ?? 'default';
  if (hash == null) {
    delete store.alertHashes[scopeKey][entryKey];
    if (Object.keys(store.alertHashes[scopeKey]).length === 0) {
      delete store.alertHashes[scopeKey];
    }
    return;
  }
  store.alertHashes[scopeKey][entryKey] = hash;
}

export function resetAlertHashes(scope) {
  if (scope) {
    delete store.alertHashes[scope];
  } else {
    store.alertHashes = {};
  }
}

export function saveStore() {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}
