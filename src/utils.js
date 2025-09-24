import { logger, withContext } from './logger.js';
import { fetchWithRetryCounter, fetchWithRetryHistogram } from './metrics.js';

/**
 * Executes an asynchronous function with exponential backoff retries.
 * @param {Function} fn - Asynchronous function to invoke.
 * @param {Object} [options] - Retry configuration.
 * @param {number} [options.retries=3] - Number of retry attempts.
 * @param {number} [options.baseDelay=500] - Initial delay in milliseconds for the backoff.
 * @returns {Promise} Resolves with the function result when successful.
 * @throws {Error} Rethrows the last error when the retry budget is exhausted.
 */
export async function fetchWithRetry(fn, { retries = 3, baseDelay = 500 } = {}) {
    const log = withContext(logger);
    fetchWithRetryCounter.inc();
    const end = fetchWithRetryHistogram.startTimer();
    log.info({ fn: 'fetchWithRetry' }, `Fetching with retry, max attempts: ${retries + 1}, function: ${fn || 'anonymous'}`);
    let attempt = 0;
    while (true) {
        try {
            const result = await fn();
            end();
            return result;
        } catch (err) {
            attempt++;
            const aggregateErrors = Array.isArray(err?.errors) ? err.errors : [];
            const codes = [err?.code, ...aggregateErrors.map(e => e?.code)].filter(Boolean);
            const isNetworkUnreachable = codes.includes('ENETUNREACH');
            if (attempt > retries || isNetworkUnreachable) {
                log.error({ fn: 'fetchWithRetry', err }, `[FATAL] ${err.message || err}`);
                end();
                throw err;
            }
            const delay = baseDelay * (2 ** (attempt - 1));
            const jitter = Math.random() * baseDelay;
                log.warn({ fn: 'fetchWithRetry', err }, `[TRANSIENT] ${err.message || err} - retrying in ${Math.round(delay + jitter)}ms`);
            await new Promise(res => setTimeout(res, delay + jitter));
        }
    }
}

/**
 * Determines a rounding threshold based on the magnitude of the price.
 * @param {number} price - Price used to determine the threshold.
 * @returns {number} Rounded threshold step.
 */
export function roundThreshold(price) {
    if (price == null || isNaN(price)) return 1;
    if (price >= 1000) return 1000;
    if (price >= 100) return 100;
    if (price >= 10) return 10;
    return 1;
}
