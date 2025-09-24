import { describe, expect, it, vi } from 'vitest';
import { runAssetsSafely } from '../src/runner.js';

describe('runAssetsSafely', () => {
    const buildLimiter = () => {
        return (task) => Promise.resolve().then(task);
    };

    it('returns empty failures list when all assets succeed', async () => {
        const assets = [{ key: 'BTC' }, { key: 'ETH' }];
        const logger = { error: vi.fn() };
        const withContext = vi.fn(() => logger);

        const failures = await runAssetsSafely({
            assets,
            limitFactory: buildLimiter,
            runAsset: vi.fn().mockResolvedValue(undefined),
            logger,
            withContext,
        });

        expect(failures).toEqual([]);
        expect(logger.error).not.toHaveBeenCalled();
        expect(withContext).not.toHaveBeenCalled();
    });

    it('captures failures and logs them without throwing', async () => {
        const assets = [{ key: 'BTC' }];
        const logger = { error: vi.fn() };
        const error = new Error('network down');
        const runAsset = vi.fn().mockRejectedValue(error);
        const withContext = vi.fn(() => logger);

        const failures = await runAssetsSafely({
            assets,
            limitFactory: buildLimiter,
            runAsset,
            logger,
            withContext,
        });

        expect(failures).toHaveLength(1);
        expect(failures[0].asset).toBe(assets[0]);
        expect(failures[0].error).toBe(error);
        expect(runAsset).toHaveBeenCalledTimes(1);
        expect(withContext).toHaveBeenCalledWith(logger, { asset: 'BTC' });
        expect(logger.error).toHaveBeenCalledWith(
            { fn: 'runAssetsSafely', err: error },
            'Asset processing failed',
        );
    });
});
