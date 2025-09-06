import axios from "axios";
import fs from "node:fs";
import FormData from "form-data";
import { CFG } from "./config.js";

export async function sendDiscordReport(assetKey, tf, summaryText, chartPath) {
    const form = new FormData();
    if (chartPath && fs.existsSync(chartPath)) {
        form.append("file", fs.createReadStream(chartPath));
    }
    form.append("payload_json", JSON.stringify({
        content: summaryText
    }));

    await axios.post(CFG.webhook, form, { headers: form.getHeaders() });
}
