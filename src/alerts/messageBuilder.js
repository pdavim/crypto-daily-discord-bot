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

function formatForecastTimestamp(isoString, timeZone) {
    if (!isoString) {
        return null;
    }
    const parsed = new Date(isoString);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }
    try {
        const formatter = new Intl.DateTimeFormat("pt-BR", {
            timeZone: timeZone || "UTC",
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        });
        return formatter.format(parsed);
    } catch (_) {
        return parsed.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
    }
}

function formatForecastLine(forecast) {
    if (!forecast || !Number.isFinite(forecast.forecastClose)) {
        return null;
    }

    const basePrice = forecast.forecastClose;
    const lastClose = Number.isFinite(forecast.lastClose) ? forecast.lastClose : null;
    const explicitDelta = Number.isFinite(forecast.delta) ? forecast.delta : null;
    const delta = explicitDelta !== null ? explicitDelta : (lastClose !== null ? basePrice - lastClose : null);
    const deltaPct = lastClose && lastClose !== 0 && Number.isFinite(basePrice)
        ? (basePrice - lastClose) / lastClose
        : null;

    const segments = [`🔮 ${basePrice.toFixed(2)}`];
    if (delta !== null) {
        const sign = delta > 0 ? "+" : "";
        const deltaSegment = `Δ ${sign}${delta.toFixed(2)}`;
        if (deltaPct !== null && Number.isFinite(deltaPct)) {
            segments.push(`${deltaSegment} (${(deltaPct * 100).toFixed(2)}%)`);
        } else {
            segments.push(deltaSegment);
        }
    }

    if (Number.isFinite(forecast.confidence)) {
        segments.push(`confiança ${(forecast.confidence * 100).toFixed(0)}%`);
    }

    const formattedTarget = formatForecastTimestamp(forecast.predictedAt, forecast.timeZone);
    if (formattedTarget) {
        segments.push(`alvo ${formattedTarget}`);
    }

    const evaluationSegments = [];
    const evaluation = forecast.evaluation;
    if (evaluation) {
        if (Number.isFinite(evaluation.pctError)) {
            evaluationSegments.push(`erro ${(evaluation.pctError * 100).toFixed(2)}%`);
        }
        if (typeof evaluation.directionHit === "boolean") {
            evaluationSegments.push(evaluation.directionHit ? "direção ✅" : "direção ❌");
        }
    }
    if (evaluationSegments.length > 0) {
        segments.push(`histórico ${evaluationSegments.join(" | ")}`);
    }

    return `    ↳ Previsão: ${segments.join(" — ")}`;
}

function buildTimeframeSection(summary, variationByTimeframe) {
    const { timeframe, guidance, decision, alerts, forecast } = summary;
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
    const forecastLine = formatForecastLine(forecast);
    if (forecastLine) {
        lines.push(forecastLine);
    }

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
    formatForecastTimestamp,
    formatForecastLine,
    buildTimeframeSection
};
