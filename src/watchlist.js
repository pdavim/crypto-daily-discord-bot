import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const WATCH_FILE = process.env.WATCHLIST_FILE ? path.resolve(process.env.WATCHLIST_FILE) : path.join(DATA_DIR, 'watchlist.json');

let list = [];
try {
  if (fs.existsSync(WATCH_FILE)) {
    const txt = fs.readFileSync(WATCH_FILE, 'utf8');
    list = JSON.parse(txt || '[]');
  } else {
    fs.mkdirSync(path.dirname(WATCH_FILE), { recursive: true });
  }
} catch (e) {
  list = [];
}

function persist() {
  const dir = path.dirname(WATCH_FILE);
  fs.mkdirSync(dir, { recursive: true });
  if (!list.length) {
    if (fs.existsSync(WATCH_FILE)) {
      fs.rmSync(WATCH_FILE);
    }
    return;
  }
  fs.writeFileSync(WATCH_FILE, JSON.stringify(list, null, 2));
}

export function getWatchlist() {
  return list.slice();
}

export function addAssetToWatch(asset) {
  if (!list.includes(asset)) {
    list.push(asset);
    persist();
    return true;
  }
  return false;
}

export function removeAssetFromWatch(asset) {
  const idx = list.indexOf(asset);
  if (idx !== -1) {
    list.splice(idx, 1);
    persist();
    return true;
  }
  return false;
}
