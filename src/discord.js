import axios from "axios";
import fs from "node:fs";
import FormData from "form-data";
import { CFG } from "./config.js";

export async function sendDiscordReport(assetKey, tf, text, chartPath) {
    const targets = [
        { url: CFG.webhooks?.[assetKey], includeImage: true },
        { url: CFG.webhookReports, includeImage: false },
        { url: CFG.webhook, includeImage: true }
    ].filter(t => t.url);

    const attemptSend = async () => {
        await Promise.all(
            targets.map(t => {
                const form = new FormData();
                if (t.includeImage && chartPath && fs.existsSync(chartPath)) {
                    form.append("file", fs.createReadStream(chartPath));
                }
                form.append(
                    "payload_json",
                    JSON.stringify({ content: text })
                );
                return axios.post(t.url, form, { headers: form.getHeaders() });
            })
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
    const form = new FormData();
    form.append("payload_json", JSON.stringify({ content: text }));
    const url = CFG.webhookAlerts ?? CFG.webhook;
    await axios.post(url, form, { headers: form.getHeaders() });
}
