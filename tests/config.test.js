import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let writeFileMock;
let settingsStore;

beforeEach(() => {
  vi.resetModules();
  settingsStore = {};
  writeFileMock = vi.fn().mockResolvedValue();
  vi.doMock('node:fs/promises', () => ({
    writeFile: writeFileMock,
  }));
  vi.doMock('../src/settings.js', () => {
    return {
      loadSettings: vi.fn(() => settingsStore),
      getSetting: vi.fn((key, fallback) => (key in settingsStore ? settingsStore[key] : fallback)),
      setSetting: vi.fn((key, value) => {
        if (value === undefined) {
          delete settingsStore[key];
          return undefined;
        }
        settingsStore[key] = value;
        return value;
      }),
    };
  });
});

afterEach(() => {
  vi.doUnmock('node:fs/promises');
  vi.doUnmock('../src/settings.js');
  vi.resetModules();
});

describe('saveConfig minimum profit normalization', () => {
  it('normalizes invalid minimum profit entries before persisting', async () => {
    const { CFG, saveConfig } = await import('../src/config.js');

    let persisted;
    writeFileMock.mockImplementation(async (_, data) => {
      persisted = JSON.parse(data);
    });

    await saveConfig({
      minimumProfitThreshold: {
        default: 0.4,
        users: {
          keep: 0.12,
          negative: -0.5,
          overflow: 3,
          text: 'invalid',
        },
      },
    });

    expect(persisted?.minimumProfitThreshold).toEqual({
      default: 0.4,
      users: { keep: 0.12 },
    });
    expect(CFG.minimumProfitThreshold).toEqual({
      default: 0.4,
      users: { keep: 0.12 },
    });
  });

  it('falls back to previous defaults when provided values are out of bounds', async () => {
    const { CFG, saveConfig } = await import('../src/config.js');

    let persisted;
    writeFileMock.mockImplementation(async (_, data) => {
      persisted = JSON.parse(data);
    });

    await saveConfig({
      minimumProfitThreshold: {
        default: 0.05,
        users: { valid: 0.2 },
      },
    });

    expect(CFG.minimumProfitThreshold).toEqual({
      default: 0.05,
      users: { valid: 0.2 },
    });

    await saveConfig({
      minimumProfitThreshold: {
        default: 2,
        users: { valid: 0.2, huge: 9 },
      },
    });

    expect(persisted?.minimumProfitThreshold).toEqual({
      default: 0.05,
      users: { valid: 0.2 },
    });
    expect(CFG.minimumProfitThreshold).toEqual({
      default: 0.05,
      users: { valid: 0.2 },
    });
  });
});
