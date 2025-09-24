import { afterEach, describe, expect, it, vi } from 'vitest';
import { enqueueAlertPayload, flushAlertQueue, clearAlertQueue } from '../../src/alerts/dispatcher.js';

describe('alert dispatcher', () => {
  afterEach(() => {
    clearAlertQueue();
  });

  it('sorts queued payloads by asset and timeframe order', async () => {
    const sender = vi.fn(() => Promise.resolve());

    enqueueAlertPayload({ asset: 'ETH', timeframe: '1h', message: 'ETH 1h' });
    enqueueAlertPayload({ asset: 'BTC', timeframe: '1h', message: 'BTC 1h' });
    enqueueAlertPayload({ asset: 'BTC', timeframe: '4h', message: 'BTC 4h' });

    await flushAlertQueue({ sender, timeframeOrder: ['4h', '1h'] });

    expect(sender).toHaveBeenCalledTimes(3);
    const order = sender.mock.calls.map(call => call[0].message);
    expect(order).toEqual(['BTC 4h', 'BTC 1h', 'ETH 1h']);
  });

  it('clears queue even when no sender provided', async () => {
    enqueueAlertPayload({ asset: 'BTC', timeframe: '4h', message: 'BTC alert' });
    await flushAlertQueue();

    const sender = vi.fn(() => Promise.resolve());
    await flushAlertQueue({ sender });
    expect(sender).not.toHaveBeenCalled();
  });
});
