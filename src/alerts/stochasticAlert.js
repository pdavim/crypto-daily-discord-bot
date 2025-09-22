import { ALERT_LEVELS, createAlert } from './shared.js';

export default function stochasticAlert({ stochasticK, thresholds }) {
    const alerts = [];
    const stochK = stochasticK?.at(-1);
    const { stochasticOverbought, stochasticOversold } = thresholds ?? {};

    if (stochK != null && stochasticOverbought != null && stochK > stochasticOverbought) {
        alerts.push(createAlert("📉 Stochastic overbought", ALERT_LEVELS.MEDIUM));
    }
    if (stochK != null && stochasticOversold != null && stochK < stochasticOversold) {
        alerts.push(createAlert("📈 Stochastic oversold", ALERT_LEVELS.MEDIUM));
    }

    return alerts;
}
