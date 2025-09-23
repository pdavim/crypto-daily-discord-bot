import axios from "axios";
import { logger, withContext } from "./logger.js";
import { fetchWithRetry } from "./utils.js";

/**
 * Sends an operational alert to the configured webhook, when available.
 * @param {string} msg - Message to deliver to the ops channel.
 * @returns {Promise} Resolves after the webhook request completes.
 */
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
