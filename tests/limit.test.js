import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockConfigModule = (value) => {
  vi.doMock('../src/config.js', () => ({
    CFG: { maxConcurrency: value },
  }));
};

describe('calcConcurrency', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns configured max concurrency when set to a positive integer', async () => {
    const cpus = vi.fn(() => [{}, {}]);
    vi.doMock('os', () => ({
      default: { cpus },
    }));
    mockConfigModule(7);

    const { calcConcurrency } = await import("../src/limit.js");

    expect(calcConcurrency()).toBe(7);
    expect(cpus).not.toHaveBeenCalled();
  });

  it('falls back to cpu count when configuration is invalid', async () => {
    const cpus = vi.fn(() => [{}, {}, {}]);
    vi.doMock('os', () => ({
      default: { cpus },
    }));
    mockConfigModule('not-a-number');

    const { calcConcurrency } = await import("../src/limit.js");

    expect(calcConcurrency()).toBe(3);
    expect(cpus).toHaveBeenCalledTimes(1);
  });

  it('returns 1 when cpu info is unavailable', async () => {
    const cpus = vi.fn(() => {
      throw new Error('unavailable');
    });
    vi.doMock('os', () => ({
      default: { cpus },
    }));
    mockConfigModule(0);

    const { calcConcurrency } = await import("../src/limit.js");

    expect(calcConcurrency()).toBe(1);
    expect(cpus).toHaveBeenCalledTimes(1);
  });
});

describe('pLimit', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('throws when concurrency is less than 1', async () => {
    mockConfigModule(undefined);
    const { default: pLimit } = await import("../src/limit.js");

    expect(() => pLimit(0)).toThrowError(
      new TypeError('Expected `concurrency` to be a number greater than 0'),
    );
  });

  it('limits the number of concurrently executing tasks', async () => {
    mockConfigModule(undefined);
    const { default: pLimit } = await import("../src/limit.js");

    const limiter = pLimit(2);

    let active = 0;
    let maxActive = 0;

    const createTask = (value, duration) =>
      limiter(async () => {
        active++;
        if (active > maxActive) {
          maxActive = active;
        }
        await new Promise((resolve) => setTimeout(resolve, duration));
        active--;
        return value;
      });

    const tasks = [
      createTask('A', 100),
      createTask('B', 200),
      createTask('C', 50),
      createTask('D', 75),
    ];

    const resultsPromise = Promise.all(tasks);

    await vi.advanceTimersByTimeAsync(500);

    const results = await resultsPromise;

    expect(results).toEqual(['A', 'B', 'C', 'D']);
    expect(maxActive).toBeLessThanOrEqual(2);
  });
});
