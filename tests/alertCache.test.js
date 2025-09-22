import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alerts-'));
const file = path.join(tmpDir, 'alerts.json');
process.env.ALERTS_CACHE_FILE = file;

async function loadModule() {
  return import('../src/alertCache.js');
}

beforeEach(() => {
  fs.rmSync(file, { force: true });
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('alert cache pruning', () => {
  it('removes entries older than the cutoff', async () => {
    vi.useFakeTimers();
    const dayMs = 24 * 60 * 60 * 1000;
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    let mod = await loadModule();
    expect(mod.shouldSend({ asset: 'BTC', tf: '1h', hash: 'old' }, 10 * dayMs)).toBe(true);
    vi.setSystemTime(new Date('2024-01-09T00:00:00Z'));
    expect(mod.shouldSend({ asset: 'BTC', tf: '1h', hash: 'new' }, 10 * dayMs)).toBe(true);
    expect(fs.existsSync(file)).toBe(true);

    mod.pruneOlderThan(7 * dayMs);

    const persisted = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(persisted).toHaveLength(1);
    expect(persisted[0].hash).toBe('new');
  });

  it('deletes the file when the cache becomes empty', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    let mod = await loadModule();
    expect(mod.shouldSend({ asset: 'BTC', tf: '1h', hash: 'only' }, 1000)).toBe(true);
    expect(fs.existsSync(file)).toBe(true);

    vi.setSystemTime(new Date('2024-01-02T00:00:00Z'));
    mod.pruneOlderThan(0);

    expect(fs.existsSync(file)).toBe(false);
  });
});
