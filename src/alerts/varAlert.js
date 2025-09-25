import { ALERT_LEVELS, ALERT_CATEGORIES, createAlert } from "./shared.js";
import { HIGHER_TIMEFRAME_METRICS } from "./variationMetrics.js";

function formatPercent(value) {
    if (!Number.isFinite(value)) {
        return null;
    }
    const sign = value > 0 ? "+" : "";
    return `${sign}${(value * 100).toFixed(2)}%`;
}

function sortLabels(labels, timeframeOrder = []) {
    const order = new Map();
    timeframeOrder.forEach((tf, index) => {
        if (!order.has(tf)) {
            order.set(tf, index);
        }
    });
    const baseIndex = order.size;
    HIGHER_TIMEFRAME_METRICS.forEach((label, index) => {
        if (!order.has(label)) {
            order.set(label, baseIndex + index);
        }
    });

    return [...labels].sort((a, b) => {
        const rankA = order.has(a) ? order.get(a) : Number.MAX_SAFE_INTEGER;
        const rankB = order.has(b) ? order.get(b) : Number.MAX_SAFE_INTEGER;
        if (rankA !== rankB) {
            return rankA - rankB;
        }
        return a.localeCompare(b);
    });
}

function sanitizeMetrics({ variationByTimeframe, timeframe, timeframeVariation, var24h }) {
    const metrics = {};
    for (const [label, value] of Object.entries(variationByTimeframe ?? {})) {
        if (Number.isFinite(value) && !Object.prototype.hasOwnProperty.call(metrics, label)) {
            metrics[label] = value;
        }
    }

    if (timeframe && Number.isFinite(timeframeVariation) && !Object.prototype.hasOwnProperty.call(metrics, timeframe)) {
        metrics[timeframe] = timeframeVariation;
    }

    if (Number.isFinite(var24h) && !Object.prototype.hasOwnProperty.call(metrics, "24h")) {
        metrics["24h"] = var24h;
    }

    return metrics;
}

export default function varAlert({ var24h, timeframe, timeframeVariation, variationByTimeframe, timeframeOrder = [] }) {
    const metrics = sanitizeMetrics({ variationByTimeframe, timeframe, timeframeVariation, var24h });
    const orderedLabels = sortLabels(Object.keys(metrics), timeframeOrder);

    const segments = [];
    for (const label of orderedLabels) {
        const formatted = formatPercent(metrics[label]);
        if (formatted) {
            segments.push(`${label} ${formatted}`);
        }
    }

    if (segments.length === 0) {
        return [];
    }

    return [createAlert(`📊 Variações: ${segments.join(" • ")}`, ALERT_LEVELS.LOW, ALERT_CATEGORIES.VOLATILITY)];
}

export const __private__ = {
    HIGHER_TIMEFRAME_METRICS,
    formatPercent,
    sortLabels,
    sanitizeMetrics
};
