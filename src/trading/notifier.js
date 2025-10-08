import { CFG } from "../config.js";
import { sendDiscordAlert } from "../discord.js";
import { recordTradingEvent } from "../controllers/sheetsReporter.js";
import { logger, withContext } from "../logger.js";

const DEFAULT_SHEET_KEY = "trading_actions";

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getTradingDiscordConfig() {
    const base = CFG?.trading?.discord;
    if (!isPlainObject(base)) {
        return { enabled: false };
    }
    return base;
}

function getSheetKey(fallback) {
    const configured = CFG?.trading?.logging;
    if (configured && typeof configured.sheetKey === "string") {
        const trimmed = configured.sheetKey.trim();
        if (trimmed !== "") {
            return trimmed;
        }
    }
    if (typeof fallback === "string" && fallback.trim() !== "") {
        return fallback.trim();
    }
    return DEFAULT_SHEET_KEY;
}

function buildMentionedContent(content, mention) {
    if (typeof mention !== "string" || mention.trim() === "") {
        return content;
    }
    if (typeof content !== "string" || content.trim() === "") {
        return mention.trim();
    }
    return `${mention.trim()} ${content}`.trim();
}

function deriveAssetLabel({ assetKey, symbol }) {
    if (typeof assetKey === "string" && assetKey.trim() !== "") {
        return assetKey.trim();
    }
    if (typeof symbol === "string" && symbol.trim() !== "") {
        return symbol.trim();
    }
    return "asset";
}

function deriveTimeframeLabel(timeframe) {
    if (typeof timeframe === "string" && timeframe.trim() !== "") {
        return timeframe.trim();
    }
    return null;
}

function formatComplianceMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) {
        return null;
    }
    const formatted = messages
        .map(message => {
            if (typeof message === "string") {
                return message.trim();
            }
            if (message == null) {
                return "";
            }
            return String(message).trim();
        })
        .filter(entry => entry !== "");
    return formatted.length > 0 ? formatted.join("; ") : null;
}

function formatComplianceSummary(compliance) {
    if (!isPlainObject(compliance)) {
        return null;
    }
    const status = typeof compliance.status === "string" ? compliance.status : "";
    if (status === "" || status === "cleared") {
        return null;
    }
    const prefix = status === "blocked"
        ? "Risk blocked"
        : status === "scaled"
            ? "Risk adjusted"
            : "Risk flag";
    const breaches = Array.isArray(compliance.breaches) ? compliance.breaches : [];
    const breachDetails = breaches
        .map(breach => {
            if (!isPlainObject(breach)) {
                return null;
            }
            const parts = [];
            if (typeof breach.type === "string" && breach.type.trim() !== "") {
                parts.push(breach.type.trim());
            }
            if (typeof breach.message === "string" && breach.message.trim() !== "") {
                parts.push(breach.message.trim());
            }
            const extras = [];
            if (Number.isFinite(breach.limit)) {
                extras.push(`limit ${formatNumber(breach.limit)}`);
            }
            if (Number.isFinite(breach.value)) {
                extras.push(`value ${formatNumber(breach.value)}`);
            }
            if (extras.length > 0) {
                parts.push(`(${extras.join(", ")})`);
            }
            if (parts.length === 0) {
                return null;
            }
            return parts.join(" ");
        })
        .filter(entry => entry != null && entry !== "");
    if (breachDetails.length > 0) {
        return `${prefix}: ${breachDetails.join("; ")}`;
    }
    const messageSummary = formatComplianceMessages(compliance.messages);
    if (messageSummary) {
        return `${prefix}: ${messageSummary}`;
    }
    return `${prefix}.`;
}

function attachComplianceMetadata(metadata = {}) {
    if (!isPlainObject(metadata)) {
        return metadata ?? {};
    }
    const enriched = { ...metadata };
    const compliance = metadata.compliance;
    if (isPlainObject(compliance)) {
        if (typeof compliance.status === "string" && compliance.status !== "") {
            enriched.complianceStatus = compliance.status;
        }
        if (Array.isArray(compliance.breaches) && compliance.breaches.length > 0) {
            enriched.complianceBreaches = compliance.breaches
                .map(breach => (isPlainObject(breach) && typeof breach.type === "string") ? breach.type : null)
                .filter(entry => entry != null);
        }
        if (Array.isArray(compliance.messages) && compliance.messages.length > 0) {
            enriched.complianceMessages = compliance.messages.slice();
        }
    }
    return enriched;
}

function formatNumber(value) {
    if (value === null || value === undefined) {
        return null;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return null;
    }
    if (Math.abs(parsed) >= 1000) {
        return parsed.toLocaleString("en-US", { maximumFractionDigits: 2 });
    }
    if (Math.abs(parsed) >= 1) {
        return parsed.toLocaleString("en-US", { maximumFractionDigits: 4 });
    }
    return parsed.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function buildDecisionContent({ assetKey, symbol, timeframe, status, action, direction, reason, confidence, quantity, compliance }) {
    const assetLabel = deriveAssetLabel({ assetKey, symbol });
    const tfLabel = deriveTimeframeLabel(timeframe);
    const base = tfLabel ? `${assetLabel} ${tfLabel}` : assetLabel;
    if (status === "executed") {
        if (action === "close") {
            const directionLabel = direction ? direction.toUpperCase() : "position";
            const summary = formatComplianceSummary(compliance);
            return `✅ Automation closed ${base} ${directionLabel} position.${summary ? ` ${summary}` : ""}`;
        }
        const directionLabel = direction ? direction.toUpperCase() : "position";
        const qtyLabel = quantity ? ` qty ${formatNumber(quantity)}` : "";
        const summary = formatComplianceSummary(compliance);
        return `✅ Automation opening ${directionLabel} on ${base}${qtyLabel ? ` (${qtyLabel})` : ""}.${summary ? ` ${summary}` : ""}`;
    }
    if (status === "error") {
        const reasonLabel = reason ? `: ${reason}` : ".";
        const summary = formatComplianceSummary(compliance);
        return `❌ Automation failed to ${action ?? "act"} on ${base}${reasonLabel}${summary ? ` ${summary}` : ""}`;
    }
    const reasonLabel = reason ? ` (${reason})` : "";
    const confidenceLabel = Number.isFinite(confidence) ? ` (confidence ${confidence.toFixed(2)})` : "";
    const summary = formatComplianceSummary(compliance);
    return `⚠️ Automation skipped ${base}${reasonLabel}${confidenceLabel}.${summary ? ` ${summary}` : ""}`;
}

function buildExecutionContent({ assetKey, symbol, action, status, side, quantity, price, notional, reason, compliance }) {
    const assetLabel = deriveAssetLabel({ assetKey, symbol });
    const directionLabel = side ? side.toUpperCase() : action;
    const qtyLabel = quantity ? ` qty ${formatNumber(quantity)}` : "";
    const priceLabel = price ? ` @ ${formatNumber(price)}` : "";
    const notionalLabel = notional ? ` (${formatNumber(notional)} notional)` : "";
    if (status === "executed") {
        const summary = formatComplianceSummary(compliance);
        return `✅ Executed ${directionLabel} for ${assetLabel}${qtyLabel}${priceLabel}${notionalLabel}.${summary ? ` ${summary}` : ""}`;
    }
    if (status === "skipped") {
        const reasonLabel = reason ? ` (${reason})` : "";
        const summary = formatComplianceSummary(compliance);
        return `⚠️ Skipped ${directionLabel} for ${assetLabel}${reasonLabel}.${summary ? ` ${summary}` : ""}`;
    }
    const reasonLabel = reason ? `: ${reason}` : ".";
    const summary = formatComplianceSummary(compliance);
    return `❌ Failed ${directionLabel} for ${assetLabel}${qtyLabel}${priceLabel}${reasonLabel}${summary ? ` ${summary}` : ""}`;
}

function buildMarginContent({ asset, amount, operation, status, reason }) {
    const assetLabel = typeof asset === "string" && asset.trim() !== "" ? asset.trim().toUpperCase() : "asset";
    const amountLabel = amount ? formatNumber(amount) : null;
    if (status === "success") {
        return `✅ Margin ${operation ?? "operation"} completed for ${amountLabel ?? "?"} ${assetLabel}.`;
    }
    if (status === "skipped") {
        const reasonLabel = reason ? ` (${reason})` : "";
        return `⚠️ Margin ${operation ?? "operation"} skipped${reasonLabel}.`;
    }
    const reasonLabel = reason ? `: ${reason}` : ".";
    return `❌ Margin ${operation ?? "operation"} failed${reasonLabel}`;
}

async function dispatchTradingEvent({
    messageType,
    content,
    assetKey,
    symbol,
    timeframe,
    metadata = {},
    fallbackSheet,
    timestamp = new Date(),
}) {
    const discordCfg = getTradingDiscordConfig();
    const log = withContext(logger, { fn: "dispatchTradingEvent", messageType, asset: assetKey ?? symbol });
    const metadataPayload = attachComplianceMetadata(metadata);
    let resolvedContent = content;
    let resolvedWebhookUrl;
    let resolvedChannelId = typeof discordCfg.channelId === "string" && discordCfg.channelId.trim() !== ""
        ? discordCfg.channelId.trim()
        : undefined;

    if (discordCfg.enabled && typeof discordCfg.webhookUrl === "string" && discordCfg.webhookUrl.trim() !== "") {
        resolvedContent = buildMentionedContent(resolvedContent, discordCfg.mention);
        try {
            const result = await sendDiscordAlert(resolvedContent, {
                webhookUrl: discordCfg.webhookUrl,
                channelId: resolvedChannelId,
            });
            resolvedWebhookUrl = result.webhookUrl ?? discordCfg.webhookUrl;
            if (result.channelId) {
                resolvedChannelId = result.channelId;
            }
        } catch (error) {
            log.error({ err: error }, "Failed to send trading log to Discord");
        }
    }

    try {
        recordTradingEvent({
            asset: assetKey ?? symbol,
            timeframe,
            messageType,
            webhookKey: getSheetKey(fallbackSheet),
            channelId: resolvedChannelId,
            webhookUrl: resolvedWebhookUrl ?? discordCfg.webhookUrl ?? null,
            content: resolvedContent,
            metadata: {
                ...metadataPayload,
                assetKey: assetKey ?? null,
                symbol: symbol ?? null,
                timeframe: timeframe ?? null,
            },
            timestamp,
        });
    } catch (error) {
        log.error({ err: error }, "Failed to enqueue trading log for Google Sheets");
    }
}

export async function reportTradingDecision({
    assetKey,
    symbol,
    timeframe,
    status,
    action,
    direction,
    reason,
    confidence,
    quantity,
    metadata = {},
    timestamp,
}) {
    const content = buildDecisionContent({
        assetKey,
        symbol,
        timeframe,
        status,
        action,
        direction,
        reason,
        confidence,
        quantity,
        compliance: metadata?.compliance,
    });

    await dispatchTradingEvent({
        messageType: "trading_decision",
        content,
        assetKey,
        symbol,
        timeframe,
        metadata: attachComplianceMetadata({
            ...metadata,
            status,
            action,
            direction,
            reason,
            confidence,
            quantity,
        }),
        fallbackSheet: CFG?.trading?.logging?.sheetKey,
        timestamp,
    });
}

export async function reportTradingExecution({
    assetKey,
    symbol,
    timeframe,
    action,
    status,
    side,
    quantity,
    price,
    notional,
    reason,
    orderId,
    metadata = {},
    timestamp,
}) {
    const content = buildExecutionContent({
        assetKey,
        symbol,
        action,
        status,
        side,
        quantity,
        price,
        notional,
        reason,
        compliance: metadata?.compliance,
    });

    await dispatchTradingEvent({
        messageType: "trading_execution",
        content,
        assetKey,
        symbol,
        timeframe,
        metadata: attachComplianceMetadata({
            ...metadata,
            status,
            action,
            side,
            quantity,
            price,
            notional,
            reason,
            orderId,
        }),
        fallbackSheet: CFG?.trading?.logging?.sheetKey,
        timestamp,
    });
}

export async function reportTradingMargin({
    asset,
    amount,
    operation,
    status,
    reason,
    metadata = {},
    timestamp,
}) {
    const content = buildMarginContent({ asset, amount, operation, status, reason });
    await dispatchTradingEvent({
        messageType: "trading_margin",
        content,
        assetKey: asset,
        symbol: asset,
        timeframe: null,
        metadata: {
            ...metadata,
            status,
            amount,
            operation,
            reason,
        },
        fallbackSheet: CFG?.trading?.logging?.sheetKey,
        timestamp,
    });
}

export const __private__ = {
    buildDecisionContent,
    buildExecutionContent,
    buildMarginContent,
    getSheetKey,
    buildMentionedContent,
};
