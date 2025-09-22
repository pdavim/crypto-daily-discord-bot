import { ALERT_LEVELS, createAlert } from './shared.js';

export default function rsiAlert({ rsiSeries, thresholds }) {
    const alerts = [];
    const rsi = rsiSeries?.at(-1);
    const prevRsi = rsiSeries?.at(-2);
    const {
        rsiOverbought,
        rsiOversold,
        rsiMidpoint
    } = thresholds ?? {};

    if (rsi != null && rsiOverbought != null && rsi > rsiOverbought) {
        alerts.push(createAlert("📉 RSI>70 (sobrecompra)", ALERT_LEVELS.HIGH));
    }
    if (rsi != null && rsiOversold != null && rsi < rsiOversold) {
        alerts.push(createAlert("📈 RSI<30 (sobrevenda)", ALERT_LEVELS.HIGH));
    }
    if (prevRsi != null && rsi != null) {
        if (rsiOverbought != null && prevRsi > rsiOverbought && rsi <= rsiOverbought) {
            alerts.push(createAlert("📉 RSI cross-back ↓ (70→<70)", ALERT_LEVELS.MEDIUM));
        }
        if (rsiOversold != null && prevRsi < rsiOversold && rsi >= rsiOversold) {
            alerts.push(createAlert("📈 RSI cross-back ↑ (<30→>30)", ALERT_LEVELS.MEDIUM));
        }
        if (
            rsiOverbought != null && rsiMidpoint != null &&
            prevRsi > rsiOverbought &&
            rsi < rsiOverbought &&
            rsi >= rsiMidpoint
        ) {
            alerts.push(createAlert("🔄 RSI neutral (de >70)", ALERT_LEVELS.LOW));
        }
        if (
            rsiOversold != null && rsiMidpoint != null &&
            prevRsi < rsiOversold &&
            rsi > rsiOversold &&
            rsi <= rsiMidpoint
        ) {
            alerts.push(createAlert("🔄 RSI neutral (de <30)", ALERT_LEVELS.LOW));
        }
        if (rsiMidpoint != null && prevRsi < rsiMidpoint && rsi >= rsiMidpoint) {
            alerts.push(createAlert("📈 RSI crossed 50↑ (momentum shift)", ALERT_LEVELS.MEDIUM));
        }
        if (rsiMidpoint != null && prevRsi > rsiMidpoint && rsi <= rsiMidpoint) {
            alerts.push(createAlert("📉 RSI crossed 50↓ (momentum shift)", ALERT_LEVELS.MEDIUM));
        }
    }

    return alerts;
}
