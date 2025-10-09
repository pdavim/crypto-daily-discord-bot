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

  it('tracks alert history with bounded capacity', async () => {
    const store = await loadStore();
    for (let i = 0; i < 205; i += 1) {
      store.appendAlertHistory({ message: `Alert ${i}`, timestamp: i });
    }
    const history = store.getAlertHistory({ limit: 250 });
    expect(history.length).toBe(200);
    expect(history[0].message).toBe('Alert 5');
    const last = history.at(-1);
    expect(last.message).toBe('Alert 204');

    const limited = store.getAlertHistory({ limit: 10 });
    expect(limited.length).toBe(10);
    expect(limited[0].message).toBe('Alert 195');
    expect(limited.at(-1).message).toBe('Alert 204');

    const defaultWindow = store.getAlertHistory();
    expect(defaultWindow.length).toBe(50);
  });
});
