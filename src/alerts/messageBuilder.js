import { formatAlertMessage } from "../alerts.js";
import { formatDecisionLine } from "./decision.js";

function formatPercent(value) {
    if (!Number.isFinite(value)) {
        return null;
    }
    const sign = value > 0 ? "+" : "";
    return `${sign}${(value * 100).toFixed(2)}%`;
}

function formatVariationOverview(variationByTimeframe = {}, timeframeOrder = []) {
    const entries = [];
    const seen = new Set();

    const pushEntry = (timeframe) => {
        if (!timeframe || seen.has(timeframe)) {
            return;
        }
        const formatted = formatPercent(variationByTimeframe[timeframe]);
        if (!formatted) {
            return;
        }
        entries.push(`${timeframe} ${formatted}`);
        seen.add(timeframe);
    };

    timeframeOrder.forEach(pushEntry);
    Object.keys(variationByTimeframe).forEach(pushEntry);

    if (!entries.length) {
        return null;
    }

    return `_Variações: ${entries.join(" • ")}_`;
}

function buildTimeframeSection(summary, variationByTimeframe) {
    const { timeframe, guidance, decision, alerts } = summary;
    if (!Array.isArray(alerts) || alerts.length === 0) {
        return [];
    }

    const headerSegments = [`> **${timeframe}**`];
    if (guidance) {
        headerSegments.push(`Recomendação: ${guidance}`);
    }
    const formattedVariation = formatPercent(variationByTimeframe?.[timeframe]);
    if (formattedVariation) {
        headerSegments.push(`Variação: ${formattedVariation}`);
    }

    const lines = [headerSegments.join(" — ")];
    const decisionLine = formatDecisionLine(decision);

    for (const alert of alerts) {
        const count = alert?.count ?? 1;
        lines.push(`• ${formatAlertMessage(alert, count)}`);
        if (decisionLine) {
            lines.push(`    ↳ Decisão: ${decisionLine}`);
        }
    }
    return lines;
}

export function buildAssetAlertMessage({
    assetKey,
    mention,
    timeframeSummaries,
    variationByTimeframe = {},
    timeframeOrder = []
}) {
    if (!Array.isArray(timeframeSummaries) || timeframeSummaries.length === 0) {
        return null;
    }

    const activeSummaries = timeframeSummaries.filter(summary => Array.isArray(summary?.alerts) && summary.alerts.length > 0);
    if (activeSummaries.length === 0) {
        return null;
    }

    const lines = [];
    const headerParts = [`**⚠️ Alertas — ${assetKey}**`];
    if (mention) {
        headerParts.push(mention);
    }
    lines.push(headerParts.join(" "));

    const variationLine = formatVariationOverview(variationByTimeframe, timeframeOrder);
    if (variationLine) {
        lines.push(variationLine);
    }

    for (const summary of activeSummaries) {
        lines.push(...buildTimeframeSection(summary, variationByTimeframe));
    }

    return lines.join("\n");
}

export const __private__ = {
    formatPercent,
    formatVariationOverview,
    buildTimeframeSection
};
