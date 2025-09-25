import { withContext as withContextDefault } from "./logger.js";

/**
 * @callback LimitExecutor
 * @param {function(): Promise<any>} task
 * @returns {Promise<any>}
 */

/**
 * @callback LimitFactory
 * @returns {LimitExecutor}
 */

/**
 * @callback AssetRunner
 * @param {*} asset
 * @returns {Promise<any>}
 */

/**
 * Executes the runOnce handler for each asset using the provided limiter while
 * ensuring individual failures are logged without aborting the entire batch.
 *
 * @param {Object} params - Execution parameters.
 * @param {Array<{key: string}>} params.assets - Assets to process.
 * @param {LimitFactory} params.limitFactory - Factory that produces a p-limit compatible limiter.
 * @param {AssetRunner} params.runAsset - Handler that processes a single asset.
 * @param {{ error: Function }} params.logger - Base logger instance.
 * @returns {Promise<Array<{ asset: any, error: unknown }>>} Rejections captured during processing.
 */
export async function runAssetsSafely({ assets, limitFactory, runAsset, logger, withContext = withContextDefault }) {
    const limit = limitFactory();
    const settled = await Promise.allSettled(assets.map(asset => limit(() => runAsset(asset))));
    const failures = [];

    settled.forEach((result, index) => {
        if (result.status === 'rejected') {
            const asset = assets[index];
            const log = withContext(logger, { asset: asset?.key });
            log.error({ fn: 'runAssetsSafely', err: result.reason }, 'Asset processing failed');
            failures.push({ asset, error: result.reason });
        }
    });

    return failures;
}
