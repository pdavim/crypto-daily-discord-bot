import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe('performance metrics', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('records samples, reports aggregated stats, and resets counters', async () => {
    const log = { debug: vi.fn() };
    vi.doMock('../src/logger.js', () => ({
      logger: { child: vi.fn() },
      withContext: vi.fn(() => log),
    }));

    const perf = await import("../src/perf.js");
    const loggerModule = await import("../src/logger.js");

    perf.recordPerf('fetchOHLCV', 50);
    perf.recordPerf('fetchOHLCV', 150);
    perf.recordPerf('customMetric', 200);

    const summary = perf.reportWeeklyPerf();

    expect(summary.fetchOHLCV).toEqual({ avg: 100, count: 2 });
    expect(summary.customMetric).toEqual({ avg: 200, count: 1 });
    expect(summary.buildAlerts).toEqual({ avg: 0, count: 0 });

    expect(loggerModule.withContext).toHaveBeenCalledWith(loggerModule.logger);
    expect(log.debug).toHaveBeenCalledWith(
      { fn: 'weeklyPerf', summary },
      'Weekly performance averages (ms)',
    );

    const resetSummary = perf.reportWeeklyPerf();

    expect(resetSummary.fetchOHLCV).toEqual({ avg: 0, count: 0 });
    expect(resetSummary.customMetric).toEqual({ avg: 0, count: 0 });
    expect(loggerModule.withContext).toHaveBeenCalledTimes(2);
  });
});
