import axios from "axios";
import fs from "node:fs";
import FormData from "form-data";
import { CFG } from "./config.js";

export async function sendDiscordReport(assetKey, tf, text, chartPath) {
    const buildForm = () => {
        const f = new FormData();
        if (chartPath && fs.existsSync(chartPath)) {
            f.append("file", fs.createReadStream(chartPath));
        }
        f.append("payload_json", JSON.stringify({
            content: text
        }));
        return f;
    };

    const urls = [
        CFG.webhooks?.[assetKey],
        CFG.webhookReports,
        CFG.webhook
    ].filter(Boolean);

    const attemptSend = async () => {
        await Promise.all(
            urls.map(u => {
                const form = buildForm();
                return axios.post(u, form, { headers: form.getHeaders() });
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
