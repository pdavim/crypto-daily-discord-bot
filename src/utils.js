export async function fetchWithRetry(fn, { retries = 3, baseDelay = 500 } = {}) {
    let attempt = 0;
    while (true) {
        try {
            return await fn();
        } catch (err) {
            attempt++;
            if (attempt > retries) {
                console.error(`[FATAL] ${err.message || err}`);
                throw err;
            }
            const delay = baseDelay * (2 ** (attempt - 1));
            const jitter = Math.random() * baseDelay;
            console.warn(`[TRANSIENT] ${err.message || err} - retrying in ${Math.round(delay + jitter)}ms`);
            await new Promise(res => setTimeout(res, delay + jitter));
        }
    }
}
