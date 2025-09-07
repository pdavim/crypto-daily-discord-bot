import axios from "axios";
import fs from "node:fs";
import FormData from "form-data";
import { CFG } from "./config.js";

export async function sendDiscordReport(assetKey, tf, text, chartPath) {
    const form = new FormData();
    if (chartPath && fs.existsSync(chartPath)) {
        form.append("file", fs.createReadStream(chartPath));
    }
    form.append("payload_json", JSON.stringify({
        content: text
    }));

    const url = CFG.webhooks?.[assetKey] ?? CFG.webhook;
    await axios.post(url, form, { headers: form.getHeaders() });
}
