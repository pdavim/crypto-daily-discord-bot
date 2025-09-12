import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

let buildHash, shouldSend;
let tempDir;

beforeEach(async () => {
  vi.useFakeTimers();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alertcache-'));
  process.env.ALERTS_CACHE_FILE = path.join(tempDir, 'alerts.json');
  vi.resetModules();
  ({ buildHash, shouldSend } = await import('../src/alertCache.js'));
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(tempDir, { recursive: true, force: true });
  delete process.env.ALERTS_CACHE_FILE;
});

describe('alertCache', () => {
  it('deduplicates alerts within time window', () => {
    const text = 'duplicate alert';
    const hash = buildHash(text);
    const windowMs = 60 * 1000;
    expect(shouldSend(hash, windowMs)).toBe(true);
    expect(shouldSend(hash, windowMs)).toBe(false);
    vi.advanceTimersByTime(windowMs + 1);
    expect(shouldSend(hash, windowMs)).toBe(true);
  });
});
