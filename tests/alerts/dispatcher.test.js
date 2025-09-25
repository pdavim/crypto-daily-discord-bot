import { afterEach, describe, expect, it, vi } from 'vitest';

async function importDispatcher({ assets } = {}) {
  vi.resetModules();
  if (assets) {
    vi.doMock('../../src/assets.js', () => ({ ASSETS: assets }));
  } else {
    vi.unmock('../../src/assets.js');
  }
  const module = await import('../../src/alerts/dispatcher.js');
  return module;
}

describe('alert dispatcher', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unmock('../../src/assets.js');
  });

  it('sorts queued payloads alphabetically when no market cap data is provided', async () => {
    const { enqueueAlertPayload, flushAlertQueue, clearAlertQueue } = await importDispatcher();
    const sender = vi.fn(() => Promise.resolve());

    enqueueAlertPayload({ asset: 'SOL', timeframe: '1h', message: 'SOL 1h' });
    enqueueAlertPayload({ asset: 'ETH', timeframe: '4h', message: 'ETH 4h' });
    enqueueAlertPayload({ asset: 'BTC', timeframe: '1h', message: 'BTC 1h' });

    await flushAlertQueue({ sender, timeframeOrder: ['4h', '1h'] });

    expect(sender).toHaveBeenCalledTimes(3);
    const order = sender.mock.calls.map(call => call[0].message);
    expect(order).toEqual(['BTC 1h', 'ETH 4h', 'SOL 1h']);

    clearAlertQueue();
  });

  it('prioritises assets with market cap rank metadata before alphabetical fallback', async () => {
    const marketCapAssets = [
      { key: 'SOL', marketCapRank: 10 },
      { key: 'BTC', marketCapRank: 1 },
      { key: 'ETH', marketCapRank: 2 },
    ];
    const { enqueueAlertPayload, flushAlertQueue, clearAlertQueue } = await importDispatcher({ assets: marketCapAssets });
    const sender = vi.fn(() => Promise.resolve());

    enqueueAlertPayload({ asset: 'SOL', timeframe: '1h', message: 'SOL 1h' });
    enqueueAlertPayload({ asset: 'BTC', timeframe: '4h', message: 'BTC 4h' });
    enqueueAlertPayload({ asset: 'ETH', timeframe: '1h', message: 'ETH 1h' });

    await flushAlertQueue({ sender, timeframeOrder: ['4h', '1h'] });

    expect(sender).toHaveBeenCalledTimes(3);
    const order = sender.mock.calls.map(call => call[0].message);
    expect(order).toEqual(['BTC 4h', 'ETH 1h', 'SOL 1h']);

    clearAlertQueue();
  });

  it('clears queue even when no sender provided', async () => {
    const { enqueueAlertPayload, flushAlertQueue, clearAlertQueue } = await importDispatcher();
    enqueueAlertPayload({ asset: 'BTC', timeframe: '4h', message: 'BTC alert' });
    await flushAlertQueue();

    const sender = vi.fn(() => Promise.resolve());
    await flushAlertQueue({ sender });
    expect(sender).not.toHaveBeenCalled();

    clearAlertQueue();
  });
});
