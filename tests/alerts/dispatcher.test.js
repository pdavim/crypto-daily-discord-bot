import { afterEach, describe, expect, it, vi } from "vitest";


async function importDispatcher({ assets } = {}) {
  vi.resetModules();
  const assetList = assets ?? [];
  vi.doMock('../../src/config.js', () => ({
    CFG: {
      assets: assetList,
      assetMap: new Map(assetList.map(asset => [asset.key, asset])),
    },
  }));
  const module = await import("../../src/alerts/dispatcher.js");

  return module;
}

describe('alert dispatcher', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unmock('../../src/config.js');
  });

  it('sorts queued payloads alphabetically when no market cap data is provided', async () => {
    const { enqueueAlertPayload, flushAlertQueue, clearAlertQueue } = await importDispatcher();
    const sender = vi.fn(() => Promise.resolve());

    enqueueAlertPayload({
      asset: 'SOL',
      timeframe: '1h',
      message: 'SOL 1h',
      messageType: 'aggregate_alert',
      metadata: { hash: 'sol-1h' },
    });
    enqueueAlertPayload({
      asset: 'ETH',
      timeframe: '4h',
      message: 'ETH 4h',
      messageType: 'aggregate_alert',
      metadata: { hash: 'eth-4h' },
    });
    enqueueAlertPayload({
      asset: 'BTC',
      timeframe: '1h',
      message: 'BTC 1h',
      messageType: 'guidance_alert',
      metadata: { hash: 'btc-1h' },
    });

    await flushAlertQueue({ sender, timeframeOrder: ['4h', '1h'] });

    expect(sender).toHaveBeenCalledTimes(3);
    const order = sender.mock.calls.map(call => call[0].message);
    expect(order).toEqual(['BTC 1h', 'ETH 4h', 'SOL 1h']);
    const types = sender.mock.calls.map(call => call[0].messageType);
    expect(types).toEqual(['guidance_alert', 'aggregate_alert', 'aggregate_alert']);
    const metadata = sender.mock.calls.map(call => call[0].metadata?.hash);
    expect(metadata).toEqual(['btc-1h', 'eth-4h', 'sol-1h']);

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

    enqueueAlertPayload({
      asset: 'SOL',
      timeframe: '1h',
      message: 'SOL 1h',
      messageType: 'aggregate_alert',
    });
    enqueueAlertPayload({
      asset: 'BTC',
      timeframe: '4h',
      message: 'BTC 4h',
      messageType: 'aggregate_alert',
    });
    enqueueAlertPayload({
      asset: 'ETH',
      timeframe: '1h',
      message: 'ETH 1h',
      messageType: 'aggregate_alert',
    });

    await flushAlertQueue({ sender, timeframeOrder: ['4h', '1h'] });

    expect(sender).toHaveBeenCalledTimes(3);
    const order = sender.mock.calls.map(call => call[0].message);
    expect(order).toEqual(['BTC 4h', 'ETH 1h', 'SOL 1h']);

    clearAlertQueue();
  });

  it('clears queue even when no sender provided', async () => {
    const { enqueueAlertPayload, flushAlertQueue, clearAlertQueue } = await importDispatcher();
    enqueueAlertPayload({ asset: 'BTC', timeframe: '4h', message: 'BTC alert', messageType: 'aggregate_alert' });
    await flushAlertQueue();

    const sender = vi.fn(() => Promise.resolve());
    await flushAlertQueue({ sender });
    expect(sender).not.toHaveBeenCalled();

    clearAlertQueue();
  });
});
