import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/logger.js', () => {
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return {
    logger: { child: vi.fn(() => log) },
    withContext: vi.fn(() => log),
  };
});

vi.mock('../src/metrics.js', () => {
  return {
    fetchWithRetryCounter: { inc: vi.fn() },
    fetchWithRetryHistogram: { startTimer: vi.fn(() => vi.fn()) },
  };
});

describe('fetchWithRetry', () => {
  let utils;
  let metrics;
  let logger;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    metrics = await import('../src/metrics.js');
    logger = await import('../src/logger.js');
    utils = await import('../src/utils.js');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('resolves immediately when the function succeeds', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    const result = await utils.fetchWithRetry(fn);

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(metrics.fetchWithRetryCounter.inc).toHaveBeenCalledTimes(1);

    const end = metrics.fetchWithRetryHistogram.startTimer.mock.results[0].value;
    expect(metrics.fetchWithRetryHistogram.startTimer).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);

    const log = logger.withContext.mock.results[0].value;
    expect(log.info).toHaveBeenCalledWith({ fn: 'fetchWithRetry' }, expect.stringContaining('max attempts'));
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('retries with exponential backoff before succeeding', async () => {
    const error = new Error('temporary failure');
    const fn = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockResolvedValue('eventual success');

    const promise = utils.fetchWithRetry(fn, { retries: 3, baseDelay: 100 });

    await vi.advanceTimersByTimeAsync(125); // first delay (100) + jitter (25)
    await vi.advanceTimersByTimeAsync(225); // second delay (200) + jitter (25)

    await expect(promise).resolves.toBe('eventual success');

    expect(fn).toHaveBeenCalledTimes(3);

    const log = logger.withContext.mock.results[0].value;
    expect(log.warn).toHaveBeenCalledTimes(2);
    expect(log.warn.mock.calls[0][1]).toContain('retrying in 125ms');
    expect(log.warn.mock.calls[1][1]).toContain('retrying in 225ms');
    expect(log.error).not.toHaveBeenCalled();
  });

  it('throws after exhausting retries', async () => {
    const error = new Error('fatal failure');
    const fn = vi.fn().mockRejectedValue(error);

    const task = utils.fetchWithRetry(fn, { retries: 2, baseDelay: 200 });
    const expectation = expect(task).rejects.toBe(error);

    await vi.advanceTimersByTimeAsync(250); // first delay (200) + jitter (50)
    await vi.advanceTimersByTimeAsync(450); // second delay (400) + jitter (50)

    await expectation;

    expect(fn).toHaveBeenCalledTimes(3);

    const log = logger.withContext.mock.results[0].value;
    expect(log.error).toHaveBeenCalledWith({ fn: 'fetchWithRetry', err: error }, `[FATAL] ${error.message}`);

    const end = metrics.fetchWithRetryHistogram.startTimer.mock.results[0].value;
    expect(end).toHaveBeenCalledTimes(1);
  });
});
