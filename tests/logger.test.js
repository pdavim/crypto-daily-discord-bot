import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe('logger helpers', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('createContext adds a request id and preserves known fields', async () => {
    const { createContext } = await import("../src/logger.js");

    const context = createContext({ asset: 'BTC/USDT', timeframe: '1h', userId: 42, skip: undefined });

    expect(context.asset).toBe('BTC/USDT');
    expect(context.timeframe).toBe('1h');
    expect(context.userId).toBe(42);
    expect(typeof context.requestId).toBe('string');
    expect(context.requestId.length).toBeGreaterThan(0);
  });

  it('withContext reuses existing context when requestId is provided', async () => {
    const { withContext } = await import("../src/logger.js");

    const child = vi.fn().mockReturnValue('child-logger');
    const baseLogger = { child };
    const existingContext = { requestId: 'existing-id', asset: 'ETH/USDT' };

    const result = withContext(baseLogger, existingContext);

    expect(result).toBe('child-logger');
    expect(child).toHaveBeenCalledWith(existingContext);
  });

  it('withContext creates a new context when requestId is missing', async () => {
    const { withContext } = await import("../src/logger.js");

    const child = vi.fn().mockReturnValue('child');
    const baseLogger = { child };

    const result = withContext(baseLogger, { asset: 'SOL/USDT' });

    expect(result).toBe('child');
    expect(child).toHaveBeenCalledTimes(1);
    const arg = child.mock.calls[0][0];
    expect(arg.asset).toBe('SOL/USDT');
    expect(typeof arg.requestId).toBe('string');
    expect(arg.requestId.length).toBeGreaterThan(0);
  });
});
