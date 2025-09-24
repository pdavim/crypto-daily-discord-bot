import { ALERT_LEVELS, ALERT_CATEGORIES, createAlert } from "./shared.js";

function formatPercent(value) {
    if (!Number.isFinite(value)) {
        return null;
    }
    const sign = value > 0 ? "+" : "";
    return `${sign}${(value * 100).toFixed(2)}%`;
}

export default function varAlert({ var24h, timeframe, timeframeVariation }) {
    const alerts = [];
    const formattedTimeframe = formatPercent(timeframeVariation);
    if (timeframe && formattedTimeframe) {
        alerts.push(createAlert(`📊 Var${timeframe}: ${formattedTimeframe}`, ALERT_LEVELS.LOW, ALERT_CATEGORIES.VOLATILITY));
    }

    const formatted24h = formatPercent(var24h);
    if (formatted24h) {
        alerts.push(createAlert(`📊 Var24h: ${formatted24h}`, ALERT_LEVELS.LOW, ALERT_CATEGORIES.VOLATILITY));
    }

    return alerts;
}
