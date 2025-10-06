import { CFG } from "../config.js";
import { appendRows } from "../googleSheets.js";
import { logger, withContext } from "../logger.js";
import {
    googleSheetsAppendAttemptCounter,
    googleSheetsAppendAttemptDurationHistogram,
    googleSheetsAppendFailureCounter,
    googleSheetsAppendFailureDurationHistogram,
    googleSheetsAppendSuccessCounter,
    googleSheetsAppendSuccessDurationHistogram,
} from "../metrics.js";
import { fetchWithRetry } from "../utils.js";

const BATCH_SIZE = 20;
const FLUSH_INTERVAL_MS = 10_000;

const queue = new Map();
const flushTimers = new Map();
const pendingFlushes = new Map();

function integrationEnabled() {
    return CFG?.googleSheets?.enabled === true;
}

function extractChannelId(url, fallback = "") {
    if (typeof url !== "string" || url.trim() === "") {
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
        // Ignore parsing errors and rely on fallback below.
    }

    return fallback;
}

function resolveSheetName({ channelId, webhookKey, fallback }) {
    const map = CFG?.googleSheets?.channelMap;
    if (channelId && typeof map?.[channelId] === "string" && map[channelId].trim() !== "") {
        return map[channelId];
    }
    if (webhookKey && typeof map?.[webhookKey] === "string" && map[webhookKey].trim() !== "") {
        return map[webhookKey];
    }
    if (typeof fallback === "string" && fallback.trim() !== "") {
        return fallback.trim();
    }
    if (channelId) {
        return channelId;
    }
    if (webhookKey) {
        return webhookKey;
    }
    return "default";
}

function formatAttachments(attachments) {
    if (!Array.isArray(attachments) || attachments.length === 0) {
        return "";
    }
    const urls = attachments
        .map(item => {
            if (typeof item === "string") {
                return item.trim();
            }
            if (item && typeof item === "object" && typeof item.url === "string") {
                return item.url.trim();
            }
            return "";
        })
        .filter(value => value !== "");
    return urls.join(", ");
}

function formatMetadata(metadata) {
    if (metadata == null) {
        return "";
    }
    if (typeof metadata === "string") {
        return metadata.trim();
    }
    try {
        return JSON.stringify(metadata);
    } catch (_) {
        return "";
    }
}

function buildRow({
    asset,
    timeframe,
    messageType,
    content,
    attachments,
    metadata,
    webhookUrl,
    channelId,
    timestamp,
}) {
    const ts = timestamp instanceof Date ? timestamp.toISOString() : new Date().toISOString();
    const normalizedContent = typeof content === "string" ? content : String(content ?? "");
    const resolvedChannelId = channelId || extractChannelId(webhookUrl, "");
    return [
        ts,
        resolvedChannelId ?? "",
        typeof webhookUrl === "string" ? webhookUrl : "",
        messageType ?? "",
        typeof asset === "string" ? asset : "",
        typeof timeframe === "string" ? timeframe : "",
        normalizedContent,
        formatAttachments(attachments),
        formatMetadata(metadata),
    ];
}

function scheduleFlush(sheetName) {
    if (flushTimers.has(sheetName)) {
        return;
    }
    const timer = setTimeout(async () => {
        flushTimers.delete(sheetName);
        try {
            await flushSheet(sheetName);
        } catch (error) {
            const log = withContext(logger, { fn: "scheduleFlush", sheet: sheetName });
            log.error({ err: error }, 'Failed to flush Google Sheets rows after scheduled delay');
        }
    }, FLUSH_INTERVAL_MS);
    flushTimers.set(sheetName, timer);
}

function enqueueRow(sheetName, row, context) {
    if (!integrationEnabled()) {
        return;
    }
    const sheetQueue = queue.get(sheetName) ?? [];
    sheetQueue.push({ row, context });
    queue.set(sheetName, sheetQueue);

    const log = withContext(logger, { fn: "enqueueRow", sheet: sheetName, ...context });
    log.debug({ queueSize: sheetQueue.length }, 'Queued Google Sheets row');

    if (sheetQueue.length >= BATCH_SIZE) {
        flushSheet(sheetName).catch(error => {
            const errorLog = withContext(logger, { fn: "enqueueRow", sheet: sheetName, ...context });
            errorLog.error({ err: error }, 'Failed to flush Google Sheets rows on batch threshold');
        });
        return;
    }

    scheduleFlush(sheetName);
}

async function flushSheet(sheetName) {
    if (!integrationEnabled()) {
        queue.clear();
        return;
    }

    if (pendingFlushes.has(sheetName)) {
        return pendingFlushes.get(sheetName);
    }

    const scheduled = flushTimers.get(sheetName);
    if (scheduled) {
        clearTimeout(scheduled);
        flushTimers.delete(sheetName);
    }

    const entries = queue.get(sheetName);
    if (!entries || entries.length === 0) {
        return;
    }

    queue.set(sheetName, []);
    const rows = entries.map(entry => entry.row);
    const contexts = entries.map(entry => entry.context).filter(Boolean);
    const log = withContext(logger, { fn: "flushSheet", sheet: sheetName });

    const metricsLabels = { sheet: sheetName, source: "sheetsReporter" };
    const assets = Array.from(new Set(contexts.map(ctx => ctx?.asset).filter(Boolean)));
    googleSheetsAppendAttemptCounter.inc(metricsLabels);
    const stopAttemptTimer = googleSheetsAppendAttemptDurationHistogram.startTimer(metricsLabels);

    const flushPromise = (async () => {
        try {
            await fetchWithRetry(() => appendRows({ sheetName, rows }), { retries: 2, baseDelay: 1_000 });
            const duration = stopAttemptTimer();
            googleSheetsAppendSuccessCounter.inc(metricsLabels);
            googleSheetsAppendSuccessDurationHistogram.observe(metricsLabels, duration);
            log.info({ rows: rows.length, assets, duration }, 'Flushed Google Sheets rows');
        } catch (error) {
            const duration = stopAttemptTimer();
            googleSheetsAppendFailureCounter.inc(metricsLabels);
            googleSheetsAppendFailureDurationHistogram.observe(metricsLabels, duration);
            const currentQueue = queue.get(sheetName) ?? [];
            queue.set(sheetName, [...entries, ...currentQueue]);
            log.error({ err: error, rows: rows.length, assets, duration }, 'Failed to flush Google Sheets rows');
            scheduleFlush(sheetName);
            throw error;
        } finally {
            pendingFlushes.delete(sheetName);
        }
    })();

    pendingFlushes.set(sheetName, flushPromise);
    return flushPromise;
}

function deriveContext({ asset, timeframe, webhookKey }) {
    const context = {};
    if (typeof asset === "string" && asset.trim() !== "") {
        context.asset = asset;
    }
    if (typeof timeframe === "string" && timeframe.trim() !== "") {
        context.timeframe = timeframe;
    }
    if (typeof webhookKey === "string" && webhookKey.trim() !== "") {
        context.webhookKey = webhookKey;
    }
    return context;
}

function recordEvent({
    asset,
    timeframe,
    webhookKey,
    channelId,
    webhookUrl,
    content,
    attachments,
    metadata,
    messageType,
    fallbackSheet,
    timestamp,
}) {
    if (!integrationEnabled()) {
        return;
    }

    const sheetName = resolveSheetName({ channelId, webhookKey, fallback: fallbackSheet ?? messageType });
    const row = buildRow({
        asset,
        timeframe,
        messageType,
        content,
        attachments,
        metadata,
        webhookUrl,
        channelId,
        timestamp,
    });
    const context = deriveContext({ asset, timeframe, webhookKey });
    enqueueRow(sheetName, row, context);
}

function resolveTradingFallbackSheet(fallback) {
    const configured = CFG?.trading?.logging;
    if (typeof configured?.sheetKey === "string") {
        const trimmed = configured.sheetKey.trim();
        if (trimmed !== "") {
            return trimmed;
        }
    }
    if (typeof fallback === "string" && fallback.trim() !== "") {
        return fallback.trim();
    }
    return "trading_actions";
}

function resolveNewsDigestFallbackSheet(fallback) {
    const configured = CFG?.newsDigest?.sheetFallback;
    if (typeof configured === "string" && configured.trim() !== "") {
        return configured.trim();
    }
    if (typeof fallback === "string" && fallback.trim() !== "") {
        return fallback.trim();
    }
    return "news_digest";
}

export function recordAlert({
    asset,
    timeframe,
    scope = "aggregate",
    webhookKey,
    channelId,
    webhookUrl,
    content,
    attachments,
    metadata,
    timestamp,
} = {}) {
    const normalizedScope = scope === "guidance" ? "guidance_alert" : "aggregate_alert";
    recordEvent({
        asset,
        timeframe,
        webhookKey,
        channelId,
        webhookUrl,
        content,
        attachments,
        metadata,
        messageType: normalizedScope,
        fallbackSheet: webhookKey || timeframe || normalizedScope,
        timestamp,
    });
}

export function recordDelivery({
    asset,
    timeframe,
    webhookKey,
    channelId,
    webhookUrl,
    content,
    attachments,
    metadata,
    messageType,
    timestamp,
} = {}) {
    recordEvent({
        asset,
        timeframe,
        webhookKey,
        channelId,
        webhookUrl,
        content,
        attachments,
        metadata,
        messageType,
        fallbackSheet: webhookKey || messageType,
        timestamp,
    });
}

export function recordAnalysisReport({
    asset,
    timeframe,
    webhookKey,
    channelId,
    webhookUrl,
    content,
    attachments,
    metadata,
    timestamp,
} = {}) {
    recordEvent({
        asset,
        timeframe,
        webhookKey,
        channelId,
        webhookUrl,
        content,
        attachments,
        metadata,
        messageType: "analysis_report",
        fallbackSheet: webhookKey || timeframe || "analysis_report",
        timestamp,
    });
}

export function recordMonthlyReport({
    asset,
    timeframe,
    webhookKey,
    channelId,
    webhookUrl,
    content,
    attachments,
    metadata,
    timestamp,
} = {}) {
    recordEvent({
        asset,
        timeframe,
        webhookKey,
        channelId,
        webhookUrl,
        content,
        attachments,
        metadata,
        messageType: "monthly_report",
        fallbackSheet: webhookKey || "monthly_report",
        timestamp,
    });
}

export function recordPortfolioGrowth({
    asset,
    timeframe,
    webhookKey,
    channelId,
    webhookUrl,
    content,
    attachments,
    metadata,
    timestamp,
} = {}) {
    recordEvent({
        asset,
        timeframe,
        webhookKey,
        channelId,
        webhookUrl,
        content,
        attachments,
        metadata,
        messageType: "portfolio_growth",
        fallbackSheet: webhookKey || "portfolio_growth",
        timestamp,
    });
}

export function recordTradingEvent({
    asset,
    timeframe,
    webhookKey,
    channelId,
    webhookUrl,
    content,
    attachments,
    metadata,
    messageType = "trading_event",
    fallbackSheet,
    timestamp,
} = {}) {
    recordEvent({
        asset,
        timeframe,
        webhookKey,
        channelId,
        webhookUrl,
        content,
        attachments,
        metadata,
        messageType,
        fallbackSheet: resolveTradingFallbackSheet(fallbackSheet ?? messageType),
        timestamp,
    });
}

export function recordChartUpload({
    asset,
    timeframe,
    webhookKey,
    channelId,
    webhookUrl,
    content,
    attachments,
    metadata,
    timestamp,
} = {}) {
    recordEvent({
        asset,
        timeframe,
        webhookKey,
        channelId,
        webhookUrl,
        content,
        attachments,
        metadata,
        messageType: "chart_upload",
        fallbackSheet: webhookKey || timeframe || "chart_upload",
        timestamp,
    });
}

export function recordNewsDigest({
    summary,
    topHeadlines,
    sentiment,
    assets,
    webhookKey,
    channelId,
    webhookUrl,
    fallbackSheet,
    timestamp,
} = {}) {
    const metadata = {};
    if (Array.isArray(topHeadlines) && topHeadlines.length > 0) {
        metadata.topHeadlines = topHeadlines;
    }
    if (Array.isArray(sentiment) && sentiment.length > 0) {
        metadata.sentiment = sentiment;
    } else if (Number.isFinite(sentiment)) {
        metadata.sentiment = sentiment;
    }
    if (Array.isArray(assets) && assets.length > 0) {
        metadata.assets = assets;
    }

    const resolvedMetadata = Object.keys(metadata).length > 0 ? metadata : undefined;
    const normalizedSummary = typeof summary === "string"
        ? summary.trim()
        : summary != null
            ? String(summary)
            : "";

    recordEvent({
        asset: undefined,
        timeframe: undefined,
        webhookKey: webhookKey ?? CFG?.newsDigest?.sheetMapKey ?? "newsDigest",
        channelId,
        webhookUrl,
        content: normalizedSummary,
        metadata: resolvedMetadata,
        messageType: "news_digest",
        fallbackSheet: resolveNewsDigestFallbackSheet(fallbackSheet),
        timestamp,
    });
}

export async function flushSheets() {
    if (!integrationEnabled()) {
        return;
    }

    const sheets = Array.from(new Set([...queue.keys(), ...pendingFlushes.keys()]));
    await Promise.all(sheets.map(sheet => flushSheet(sheet)));
}
