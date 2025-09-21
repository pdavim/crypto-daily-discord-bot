import axios from "axios";
import { logger, withContext } from "./logger.js";
import { fetchWithRetry } from "./utils.js";

export async function notifyOps(msg) {
    const url = process.env.OPS_WEBHOOK_URL;
    const log = withContext(logger);

    if (!url) {
        log.warn({ fn: 'notifyOps' }, 'OPS_WEBHOOK_URL not configured—skipping notification.');
        return;
    }

    try {
        await fetchWithRetry(() => axios.post(url, { content: msg }), { retries: 2 });
    } catch (err) {
        log.error({ fn: 'notifyOps', err }, 'Failed to notify ops');
    }
}
