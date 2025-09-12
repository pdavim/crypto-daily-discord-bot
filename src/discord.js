import axios from "axios";
import { CFG } from "./config.js";
import { logger } from "./logger.js";
import { fetchWithRetry } from "./utils.js";

export async function postAnalysis(assetKey, tf, text) {
    const url = CFG.webhookAnalysis;
    if (!url) {
        logger.warn({ asset: assetKey, timeframe: tf, fn: 'postAnalysis' }, "DISCORD_WEBHOOK_ANALYSIS_URL not configured—skipping post.");
        return false;
    }

    try {
        await fetchWithRetry(() => axios.post(url, { content: text }), { retries: 2 });
        return true;
    } catch (err) {
        logger.error({ asset: assetKey, timeframe: tf, fn: 'postAnalysis', err }, 'Failed to post analysis after retries');
        return false;
    }
}

export async function sendDiscordAlert(text) {
    const url = CFG.webhookAlerts ?? CFG.webhook;

    try {
        await fetchWithRetry(() => axios.post(url, { content: text }), { retries: 2 });
        return true;
    } catch (err) {
        logger.error({ asset: undefined, timeframe: undefined, fn: 'sendDiscordAlert', err }, 'Failed to send alert after retries');
        return false;
    }
}
