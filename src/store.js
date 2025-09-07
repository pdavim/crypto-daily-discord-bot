import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'run-signatures.json');

let store = {};
try {
  if (fs.existsSync(STORE_FILE)) {
    const txt = fs.readFileSync(STORE_FILE, 'utf8');
    store = JSON.parse(txt || '{}');
  } else {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (e) {
  store = {};
}

export function getSignature(key) {
  return store[key];
}

export function updateSignature(key, value) {
  store[key] = value;
}

export function saveStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}
