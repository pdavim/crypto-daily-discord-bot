import axios from "axios";
import { CFG } from "./config.js";
import { logger } from "./logger.js";

export async function postAnalysis(assetKey, tf, text) {
    const url = CFG.webhookAnalysis;
    if (!url) {
        logger.warn({ asset: assetKey, timeframe: tf, fn: 'postAnalysis' }, "DISCORD_WEBHOOK_ANALYSIS_URL not configured—skipping post.");
        return false;
    }
    const attemptSend = async () => {
        await axios.post(url, { content: text });
    };

    try {
        await attemptSend();
        return true;
    } catch (err) {
        logger.error({ asset: assetKey, timeframe: tf, fn: 'postAnalysis', err }, 'Failed to post analysis');
        try {
            await attemptSend();
            return true;
        } catch (retryErr) {
            logger.error({ asset: assetKey, timeframe: tf, fn: 'postAnalysis', err: retryErr }, 'Retry failed');
            return false;
        }
    }
}

export async function sendDiscordAlert(text) {
    const url = CFG.webhookAlerts ?? CFG.webhook;
    const attemptSend = async () => {
        await axios.post(url, { content: text });
    };

    try {
        await attemptSend();
        return true;
    } catch (err) {
        logger.error({ asset: undefined, timeframe: undefined, fn: 'sendDiscordAlert', err }, 'Failed to send alert');
        try {
            await attemptSend();
            return true;
        } catch (retryErr) {
            logger.error({ asset: undefined, timeframe: undefined, fn: 'sendDiscordAlert', err: retryErr }, 'Retry failed for alert');
            return false;
        }
    }
}
