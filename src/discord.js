import axios from "axios";
import { CFG } from "./config.js";

export async function postAnalysis(assetKey, tf, text) {
    const url = CFG.webhookAnalysis;
    if (!url) {
        console.warn("DISCORD_WEBHOOK_ANALYSIS_URL not configured—skipping post.");
        return false;
    }
    const attemptSend = async () => {
        await axios.post(url, { content: text });
    };

    try {
        await attemptSend();
        return true;
    } catch (err) {
        console.error(`Failed to post analysis for ${assetKey} ${tf}`, err?.message || err);
        try {
            await attemptSend();
            return true;
        } catch (retryErr) {
            console.error(`Retry failed for ${assetKey} ${tf}`, retryErr?.message || retryErr);
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
        console.error("Failed to send alert", err?.message || err);
        try {
            await attemptSend();
            return true;
        } catch (retryErr) {
            console.error("Retry failed for alert", retryErr?.message || retryErr);
            return false;
        }
    }
}
