import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tempDirs = [];

function createTempSettingsPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-test-'));
  tempDirs.push(dir);
  return path.join(dir, 'settings.json');
}

describe('settings persistence', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.SETTINGS_FILE = createTempSettingsPath();
  });

  afterEach(() => {
    delete process.env.SETTINGS_FILE;
  });

  it('loads persisted settings and merges defaults', async () => {
    const settingsPath = process.env.SETTINGS_FILE;
    fs.writeFileSync(settingsPath, JSON.stringify({ persisted: true }));

    const { loadSettings } = await import('../src/settings.js');

    const result = loadSettings({ defaultOnly: 'value' });

    expect(result).toEqual({ persisted: true, defaultOnly: 'value' });
  });

  it('sets and removes values while persisting to disk', async () => {
    const settingsPath = process.env.SETTINGS_FILE;

    const { loadSettings, setSetting, getSetting } = await import('../src/settings.js');

    loadSettings();
    setSetting('alpha', 42);

    const onDisk = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    expect(onDisk).toEqual({ alpha: 42 });
    expect(getSetting('alpha')).toBe(42);

    setSetting('alpha', undefined);
    expect(fs.existsSync(settingsPath)).toBe(false);
  });

  it('resets state and removes the persisted file', async () => {
    const settingsPath = process.env.SETTINGS_FILE;

    const { loadSettings, setSetting, resetSettings, getSettings } = await import('../src/settings.js');

    loadSettings();
    setSetting('beta', 'value');
    expect(fs.existsSync(settingsPath)).toBe(true);

    resetSettings();

    expect(fs.existsSync(settingsPath)).toBe(false);
    expect(getSettings()).toEqual({});
  });
});

afterAll(() => {
  for (const dir of tempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      // ignore cleanup errors
    }
  }
});
