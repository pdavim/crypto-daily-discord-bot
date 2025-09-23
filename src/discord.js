import axios from "axios";
import FormData from "form-data";
import { promises as fs } from "fs";
import path from "path";
import { CFG } from "./config.js";
import { logger, withContext } from "./logger.js";
import { fetchWithRetry } from "./utils.js";
import { alertCounter, alertHistogram } from "./metrics.js";
import { notifyOps } from "./monitor.js";
import { limit } from "./discordRateLimit.js";
import { buildSummaryPdf } from "./reporter.js";

const REPORTS_DIR = "reports";

async function saveAnalysisReport(text, { assetKey, timeframe }) {
    if (text == null) {
        return null;
    }

    const date = new Date();
    const dateStr = date.toISOString().split("T")[0];
    const relativePath = path.join(REPORTS_DIR, `${dateStr}.txt`);
    const absolutePath = path.resolve(relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });

    const timestamp = date.toISOString();
    const metadataParts = [];
    if (assetKey) {
        metadataParts.push(`asset=${assetKey}`);
    }
    if (timeframe) {
        metadataParts.push(`timeframe=${timeframe}`);
    }
    const metadata = metadataParts.length > 0 ? ` ${metadataParts.join(" ")}` : "";
    const sanitized = typeof text === "string" ? text.replace(/\s+$/, "") : String(text);
    const entry = `[${timestamp}]${metadata}\n${sanitized}\n\n`;
    await fs.appendFile(absolutePath, entry, "utf8");
    return relativePath;
}

/**
 * Sends a technical analysis report to the configured Discord webhook.
 * @param {string} assetKey - Asset identifier.
 * @param {string} tf - Timeframe label.
 * @param {string} text - Markdown analysis content.
 * @returns {Promise} Result containing the persisted report path and delivery status.
 */
export async function postAnalysis(assetKey, tf, text) {
    const normalizedAssetKey = typeof assetKey === 'string' ? assetKey.toUpperCase() : undefined;
    const candidateKeys = [];
    if (normalizedAssetKey) {
        candidateKeys.push(`webhookReports_${normalizedAssetKey}`);
        if (normalizedAssetKey === 'DAILY') {
            candidateKeys.push('webhookDaily');
        }
    }
    candidateKeys.push('webhookReports');
    candidateKeys.push('webhookAnalysis');
    if (normalizedAssetKey !== 'DAILY') {
        candidateKeys.push('webhookDaily');
    }
    const filteredCandidates = candidateKeys.filter((key, idx) => key && candidateKeys.indexOf(key) === idx);
    let resolvedConfigKey;
    let url;
    for (const key of filteredCandidates) {
        if (CFG[key]) {
            resolvedConfigKey = key;
            url = CFG[key];
            break;
        }
    }

    const log = withContext(logger, { asset: assetKey, timeframe: tf, webhookConfigKey: resolvedConfigKey });
    let savedReportPath = null;
    try {
        savedReportPath = await saveAnalysisReport(text, { assetKey, timeframe: tf });
    } catch (err) {
        log.error({ fn: 'postAnalysis', err }, 'Failed to persist analysis report');
    }
    if (!url) {
        log.warn({ fn: 'postAnalysis', tried: filteredCandidates }, 'No Discord webhook configured for analysis posts—skipping post.');
        return { posted: false, path: savedReportPath };
    }

    const payload = { content: text };
    let pdfBuffer;
    let pdfFilename;

    if (text) {
        try {
            pdfBuffer = await buildSummaryPdf(text, { assetKey, timeframe: tf });
            const ts = new Date().toISOString().split("T")[0];
            const safeAsset = (assetKey || "asset").replace(/[^a-z0-9_-]/gi, "_");
            const safeTf = (tf || "tf").replace(/[^a-z0-9_-]/gi, "_");
            pdfFilename = `${safeAsset}-${safeTf}-${ts}.pdf`;
        } catch (err) {
            log.error({ fn: 'postAnalysis', err }, 'Failed to build PDF for analysis, falling back to text only.');
        }
    }

    try {
        if (pdfBuffer) {
            const sendWithPdf = () => {
                const form = new FormData();
                form.append("payload_json", JSON.stringify(payload));
                form.append("files[0]", pdfBuffer, { filename: pdfFilename, contentType: "application/pdf" });
                return axios.post(url, form, { headers: form.getHeaders() });
            };
            await fetchWithRetry(sendWithPdf, { retries: 2 });
            return { posted: true, path: savedReportPath };
        }
        await fetchWithRetry(() => axios.post(url, payload), { retries: 2 });
        return { posted: true, path: savedReportPath };
    } catch (err) {
        if (pdfBuffer) {
            log.error({ fn: 'postAnalysis', err }, 'Failed to post analysis with PDF, retrying with text only.');
            try {
                await fetchWithRetry(() => axios.post(url, payload), { retries: 2 });
                return { posted: true, path: savedReportPath };
            } catch (fallbackErr) {
                log.error({ fn: 'postAnalysis', err: fallbackErr }, 'Failed to post analysis after PDF fallback');
                await notifyOps(`Failed to post analysis for ${assetKey} ${tf}: ${fallbackErr.message || fallbackErr}`);
                return { posted: false, path: savedReportPath };
            }
        }

        log.error({ fn: 'postAnalysis', err }, 'Failed to post analysis after retries');
        await notifyOps(`Failed to post analysis for ${assetKey} ${tf}: ${err.message || err}`);
        return { posted: false, path: savedReportPath };
    }
}

/**
 * Posts the monthly performance summary to Discord, optionally attaching a chart.
 * @param {Object} [params={}] - Report payload options.
 * @param {string} [params.content] - Text content to send.
 * @param {string} [params.filePath] - Path to an image file that will be attached.
 * @returns {Promise} True when the report is successfully sent.
 */
export async function postMonthlyReport({ content, filePath } = {}) {
    const candidateKeys = [
        'webhookMonthly',
        'webhookReports',
        'webhookAnalysis',
        'webhookDaily',
        'webhook',
    ];
    let resolvedConfigKey;
    let url;
    for (const key of candidateKeys) {
        if (CFG[key]) {
            resolvedConfigKey = key;
            url = CFG[key];
            break;
        }
    }

    const log = withContext(logger, { fn: 'postMonthlyReport', webhookConfigKey: resolvedConfigKey });
    if (!url) {
        log.warn({ fn: 'postMonthlyReport', tried: candidateKeys }, 'No Discord webhook configured for monthly report.');
        return false;
    }

    let buffer;
    let filename;
    if (filePath) {
        try {
            buffer = await fs.readFile(filePath);
            filename = path.basename(filePath);
        } catch (err) {
            log.error({ fn: 'postMonthlyReport', err, filePath }, 'Failed to read monthly chart file.');
        }
    }

    const payload = { content: content ?? '' };

    try {
        if (buffer && filename) {
            const form = new FormData();
            form.append('payload_json', JSON.stringify(payload));
            form.append('files[0]', buffer, { filename, contentType: 'image/png' });
            await fetchWithRetry(() => axios.post(url, form, { headers: form.getHeaders() }), { retries: 2 });
            return true;
        }
        await fetchWithRetry(() => axios.post(url, payload), { retries: 2 });
        return true;
    } catch (err) {
        log.error({ fn: 'postMonthlyReport', err }, 'Failed to post monthly report after retries');
        await notifyOps(`Failed to post monthly report: ${err.message || err}`);
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

/**
 * Dispatches an alert message to Discord honouring webhook rate limits.
 * @param {string} text - Alert message body.
 * @param {Object} [options={}] - Override options for delivery.
 * @param {string} [options.webhookUrl] - Custom webhook URL.
 * @param {string} [options.channelId] - Explicit channel identifier used for rate limiting.
 * @returns {Promise} True when the alert is delivered successfully.
 */
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
