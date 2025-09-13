import axios from "axios";
import { CFG } from "./config.js";
import { logger, withContext, createContext } from "./logger.js";
import { fetchWithRetry } from "./utils.js";

export async function postAnalysis(assetKey, tf, text) {
    const url = CFG.webhookAnalysis;
    const log = withContext(logger, createContext({ asset: assetKey, timeframe: tf }));
    if (!url) {
        log.warn({ fn: 'postAnalysis' }, "DISCORD_WEBHOOK_ANALYSIS_URL not configured—skipping post.");
        return false;
    }

    try {
        await fetchWithRetry(() => axios.post(url, { content: text }), { retries: 2 });
        return true;
    } catch (err) {
        log.error({ fn: 'postAnalysis', err }, 'Failed to post analysis after retries');
        return false;
    }
}

export async function sendDiscordAlert(text) {
    const url = CFG.webhookAlerts ?? CFG.webhook;
    const log = withContext(logger, createContext());

    try {
        await fetchWithRetry(() => axios.post(url, { content: text }), { retries: 2 });
        return true;
    } catch (err) {
        log.error({ fn: 'sendDiscordAlert', err }, 'Failed to send alert after retries');
        return false;
    }
}
