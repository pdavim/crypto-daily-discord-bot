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

function buildDecisionContent({ assetKey, symbol, timeframe, status, action, direction, reason, confidence, quantity }) {
    const assetLabel = deriveAssetLabel({ assetKey, symbol });
    const tfLabel = deriveTimeframeLabel(timeframe);
    const base = tfLabel ? `${assetLabel} ${tfLabel}` : assetLabel;
    if (status === "executed") {
        if (action === "close") {
            const directionLabel = direction ? direction.toUpperCase() : "position";
            return `✅ Automation closed ${base} ${directionLabel} position.`;
        }
        const directionLabel = direction ? direction.toUpperCase() : "position";
        const qtyLabel = quantity ? ` qty ${formatNumber(quantity)}` : "";
        return `✅ Automation opening ${directionLabel} on ${base}${qtyLabel ? ` (${qtyLabel})` : ""}.`;
    }
    if (status === "error") {
        const reasonLabel = reason ? `: ${reason}` : ".";
        return `❌ Automation failed to ${action ?? "act"} on ${base}${reasonLabel}`;
    }
    const reasonLabel = reason ? ` (${reason})` : "";
    const confidenceLabel = Number.isFinite(confidence) ? ` (confidence ${confidence.toFixed(2)})` : "";
    return `⚠️ Automation skipped ${base}${reasonLabel}${confidenceLabel}.`;
}

function buildExecutionContent({ assetKey, symbol, action, status, side, quantity, price, notional, reason }) {
    const assetLabel = deriveAssetLabel({ assetKey, symbol });
    const directionLabel = side ? side.toUpperCase() : action;
    const qtyLabel = quantity ? ` qty ${formatNumber(quantity)}` : "";
    const priceLabel = price ? ` @ ${formatNumber(price)}` : "";
    const notionalLabel = notional ? ` (${formatNumber(notional)} notional)` : "";
    if (status === "executed") {
        return `✅ Executed ${directionLabel} for ${assetLabel}${qtyLabel}${priceLabel}${notionalLabel}.`;
    }
    if (status === "skipped") {
        const reasonLabel = reason ? ` (${reason})` : "";
        return `⚠️ Skipped ${directionLabel} for ${assetLabel}${reasonLabel}.`;
    }
    const reasonLabel = reason ? `: ${reason}` : ".";
    return `❌ Failed ${directionLabel} for ${assetLabel}${qtyLabel}${priceLabel}${reasonLabel}`;
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
                ...metadata,
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
    });

    await dispatchTradingEvent({
        messageType: "trading_decision",
        content,
        assetKey,
        symbol,
        timeframe,
        metadata: {
            ...metadata,
            status,
            action,
            direction,
            reason,
            confidence,
            quantity,
        },
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
    });

    await dispatchTradingEvent({
        messageType: "trading_execution",
        content,
        assetKey,
        symbol,
        timeframe,
        metadata: {
            ...metadata,
            status,
            action,
            side,
            quantity,
            price,
            notional,
            reason,
            orderId,
        },
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
