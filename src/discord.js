import axios from "axios";
import { CFG } from "./config.js";

export async function sendDiscordReport(assetKey, tf, text) {
    const targets = assetKey === "DAILY"
        ? [CFG.webhookDaily || CFG.webhook].filter(Boolean)
        : [
            CFG.webhooks?.[assetKey],
            CFG.webhookReports,
            CFG.webhook
        ].filter(Boolean);

    const attemptSend = async () => {
        await Promise.all(
            targets.map(url => axios.post(url, { content: text }))
        );
    };

    try {
        await attemptSend();
        return true;
    } catch (err) {
        console.error(`Failed to send report for ${assetKey} ${tf}`, err?.message || err);
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
    await axios.post(url, { content: text });
}
