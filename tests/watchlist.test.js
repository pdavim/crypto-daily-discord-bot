import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock('../src/config.js', () => ({
  CFG: {},
  config: {},
  saveConfig: vi.fn(),
  validateConfig: vi.fn(),
}));

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watchlist-'));
const file = path.join(tmpDir, 'watch.json');
process.env.WATCHLIST_FILE = file;

async function loadModule() {
  return import("../src/watchlist.js");
}

beforeEach(() => {
  fs.rmSync(file, { force: true });
  vi.resetModules();
});

describe('watchlist persistence', () => {
  it('adds and removes assets per user', async () => {
    const USER_ID = 'user-1';
    let mod = await loadModule();
    expect(mod.getWatchlist(USER_ID)).toEqual([]);
    expect(mod.addAssetToWatch(USER_ID, 'BTC')).toBe(true);
    expect(mod.getWatchlist(USER_ID)).toEqual(['BTC']);
    expect(mod.addAssetToWatch(USER_ID, 'BTC')).toBe(false);
    expect(mod.getWatchlist(USER_ID)).toEqual(['BTC']);
    expect(mod.removeAssetFromWatch(USER_ID, 'BTC')).toBe(true);
    expect(mod.getWatchlist(USER_ID)).toEqual([]);
    expect(mod.removeAssetFromWatch(USER_ID, 'BTC')).toBe(false);
  });

  it('persists to disk per user', async () => {
    const USER_ID = 'user-2';
    let mod = await loadModule();
    mod.addAssetToWatch(USER_ID, 'ETH');
    vi.resetModules();
    mod = await loadModule();
    expect(mod.getWatchlist(USER_ID)).toEqual(['ETH']);
    mod.removeAssetFromWatch(USER_ID, 'ETH');
    expect(fs.existsSync(file)).toBe(false);
    vi.resetModules();
    mod = await loadModule();
    expect(mod.getWatchlist(USER_ID)).toEqual([]);
  });

  it('migrates legacy array data', async () => {
    fs.writeFileSync(file, JSON.stringify(['BTC', 'ETH']));
    const mod = await loadModule();
    expect(mod.getWatchlist()).toEqual(expect.arrayContaining(['BTC', 'ETH']));
    expect(fs.readFileSync(file, 'utf8')).toContain('__legacy__');
  });
});
