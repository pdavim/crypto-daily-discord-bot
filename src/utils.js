import { logger, withContext, createContext } from './logger.js';
import { fetchWithRetryCounter, fetchWithRetryHistogram } from './metrics.js';

export async function fetchWithRetry(fn, { retries = 3, baseDelay = 500 } = {}) {
    const log = withContext(logger, createContext());
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
            if (attempt > retries) {
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

export function roundThreshold(price) {
    if (price == null || isNaN(price)) return 1;
    if (price >= 1000) return 1000;
    if (price >= 100) return 100;
    if (price >= 10) return 10;
    return 1;
}
