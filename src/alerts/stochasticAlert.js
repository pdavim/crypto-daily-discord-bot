import { ALERT_LEVELS, ALERT_CATEGORIES, createAlert } from "./shared.js";

export default function stochasticAlert({ stochasticK, thresholds }) {
    const alerts = [];
    const stochK = stochasticK?.at(-1);
    const { stochasticOverbought, stochasticOversold } = thresholds ?? {};

    if (stochK != null && stochasticOverbought != null && stochK > stochasticOverbought) {
        alerts.push(createAlert("📉 Stochastic overbought", ALERT_LEVELS.MEDIUM, ALERT_CATEGORIES.MOMENTUM));
    }
    if (stochK != null && stochasticOversold != null && stochK < stochasticOversold) {
        alerts.push(createAlert("📈 Stochastic oversold", ALERT_LEVELS.MEDIUM, ALERT_CATEGORIES.MOMENTUM));
    }

    return alerts;
}
