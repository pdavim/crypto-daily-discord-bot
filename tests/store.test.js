import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-'));
const file = path.join(tmpDir, 'signatures.json');
process.env.RUN_SIGNATURES_FILE = file;

async function loadStore() {
  return import("../src/store.js");
}

beforeEach(() => {
  fs.rmSync(file, { force: true });
  vi.resetModules();
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.RUN_SIGNATURES_FILE;
});

describe('store persistence', () => {
  it('persists signatures and alert hashes', async () => {
    let store = await loadStore();
    expect(store.getSignature('foo')).toBeUndefined();
    store.updateSignature('foo', 123);
    store.updateAlertHash('daily', 'digest', 'abc');
    store.saveStore();

    vi.resetModules();
    store = await loadStore();
    expect(store.getSignature('foo')).toBe(123);
    expect(store.getAlertHash('daily', 'digest')).toBe('abc');
  });

  it('normalizes legacy flat structure', async () => {
    fs.writeFileSync(file, JSON.stringify({ 'BTC:1h': 42 }), 'utf8');
    const store = await loadStore();
    expect(store.getSignature('BTC:1h')).toBe(42);
    expect(store.getAlertHash('daily', 'analysis')).toBeUndefined();
  });

  it('resets alert hashes by scope', async () => {
    let store = await loadStore();
    store.updateAlertHash('daily', 'digest', 'abc');
    store.updateAlertHash('weekly', 'digest', 'def');
    expect(store.getAlertHash('daily', 'digest')).toBe('abc');
    expect(store.getAlertHash('weekly', 'digest')).toBe('def');

    store.resetAlertHashes('daily');
    expect(store.getAlertHash('daily', 'digest')).toBeUndefined();
    expect(store.getAlertHash('weekly', 'digest')).toBe('def');

    store.resetAlertHashes();
    expect(store.getAlertHash('weekly', 'digest')).toBeUndefined();
  });
});
