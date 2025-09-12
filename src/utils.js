import { logger } from './logger.js';

export async function fetchWithRetry(fn, { retries = 3, baseDelay = 500 } = {}) {
    logger.info({ asset: undefined, timeframe: undefined, fn: 'fetchWithRetry' }, `Fetching with retry, max attempts: ${retries + 1}, function: ${fn || 'anonymous'}`);
    let attempt = 0;
    while (true) {
        try {
            return await fn();
        } catch (err) {
            attempt++;
            if (attempt > retries) {
                logger.error({ asset: undefined, timeframe: undefined, fn: 'fetchWithRetry', err }, `[FATAL] ${err.message || err}`);
                throw err;
            }
            const delay = baseDelay * (2 ** (attempt - 1));
            const jitter = Math.random() * baseDelay;
                logger.warn({ asset: undefined, timeframe: undefined, fn: 'fetchWithRetry', err }, `[TRANSIENT] ${err.message || err} - retrying in ${Math.round(delay + jitter)}ms`);
            await new Promise(res => setTimeout(res, delay + jitter));
        }
    }
}

export function roundThreshold(price) {
    if (price == null || isNaN(price)) return 1;
    if (price >= 1000) return 1000;
    if (price >= 100) return 100;
    if (price >= 10) return 10;
    return 1;
}
