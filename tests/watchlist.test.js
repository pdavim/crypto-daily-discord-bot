import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watchlist-'));
const file = path.join(tmpDir, 'watch.json');
process.env.WATCHLIST_FILE = file;

async function loadModule() {
  return import('../src/watchlist.js');
}

beforeEach(() => {
  fs.rmSync(file, { force: true });
  vi.resetModules();
});

describe('watchlist persistence', () => {
  it('adds and removes assets', async () => {
    let mod = await loadModule();
    expect(mod.getWatchlist()).toEqual([]);
    expect(mod.addAssetToWatch('BTC')).toBe(true);
    expect(mod.getWatchlist()).toEqual(['BTC']);
    expect(mod.addAssetToWatch('BTC')).toBe(false);
    expect(mod.getWatchlist()).toEqual(['BTC']);
    expect(mod.removeAssetFromWatch('BTC')).toBe(true);
    expect(mod.getWatchlist()).toEqual([]);
    expect(mod.removeAssetFromWatch('BTC')).toBe(false);
  });

  it('persists to disk', async () => {
    let mod = await loadModule();
    mod.addAssetToWatch('ETH');
    vi.resetModules();
    mod = await loadModule();
    expect(mod.getWatchlist()).toEqual(['ETH']);
    mod.removeAssetFromWatch('ETH');
    vi.resetModules();
    mod = await loadModule();
    expect(mod.getWatchlist()).toEqual([]);
  });
});
