import axios from "axios";
import { CFG } from "./config.js";
import { logger, withContext } from "./logger.js";
import { fetchWithRetry } from "./utils.js";
import { alertCounter, alertHistogram } from "./metrics.js";
import { notifyOps } from "./monitor.js";
import { limit } from "./discordRateLimit.js";

export async function postAnalysis(assetKey, tf, text) {
    const url = CFG.webhookAnalysis;
    const log = withContext(logger, { asset: assetKey, timeframe: tf });
    if (!url) {
        log.warn({ fn: 'postAnalysis' }, "DISCORD_WEBHOOK_ANALYSIS_URL not configured—skipping post.");
        return false;
    }

    try {
        await fetchWithRetry(() => axios.post(url, { content: text }), { retries: 2 });
        return true;
    } catch (err) {
        log.error({ fn: 'postAnalysis', err }, 'Failed to post analysis after retries');
        await notifyOps(`Failed to post analysis for ${assetKey} ${tf}: ${err.message || err}`);
        return false;
    }
}

const extractChannelId = (url, fallback = "default") => {
    if (typeof url !== "string") {
        return fallback;
    }

    try {
        const parsed = new URL(url);
        const parts = parsed.pathname.split("/").filter(Boolean);
        const webhookIndex = parts.indexOf("webhooks");
        if (webhookIndex !== -1 && parts.length > webhookIndex + 1) {
            return parts[webhookIndex + 1];
        }
    } catch (_) {
        // Ignore parsing errors and fall through to default fallback below.
    }

    return fallback;
};

export async function sendDiscordAlert(text, options = {}) {
    const url = options.webhookUrl ?? CFG.webhookAlerts ?? CFG.webhook;
    const log = withContext(logger);
    const providedChannelId = typeof options.channelId === "string" && options.channelId.trim() !== ""
        ? options.channelId
        : undefined;
    const channelId = providedChannelId ?? extractChannelId(url);
    alertCounter.inc();
    const end = alertHistogram.startTimer();

    try {
        await limit.consume(channelId);
        await fetchWithRetry(() => axios.post(url, { content: text }), { retries: 2 });
        end();
        return true;
    } catch (err) {
        end();
        log.error({ fn: 'sendDiscordAlert', err }, 'Failed to send alert after retries');
        await notifyOps(`Failed to send alert: ${err.message || err}`);
        return false;
    }
}
