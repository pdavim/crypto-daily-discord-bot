import { ALERT_LEVELS, ALERT_CATEGORIES, createAlert } from './shared.js';

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
        alerts.push(createAlert("📉 RSI>70 (sobrecompra)", ALERT_LEVELS.HIGH, ALERT_CATEGORIES.MOMENTUM));
    }
    if (rsi != null && rsiOversold != null && rsi < rsiOversold) {
        alerts.push(createAlert("📈 RSI<30 (sobrevenda)", ALERT_LEVELS.HIGH, ALERT_CATEGORIES.MOMENTUM));
    }
    if (prevRsi != null && rsi != null) {
        if (rsiOverbought != null && prevRsi > rsiOverbought && rsi <= rsiOverbought) {
            alerts.push(createAlert("📉 RSI cross-back ↓ (70→<70)", ALERT_LEVELS.MEDIUM, ALERT_CATEGORIES.MOMENTUM));
        }
        if (rsiOversold != null && prevRsi < rsiOversold && rsi >= rsiOversold) {
            alerts.push(createAlert("📈 RSI cross-back ↑ (<30→>30)", ALERT_LEVELS.MEDIUM, ALERT_CATEGORIES.MOMENTUM));
        }
        if (
            rsiOverbought != null && rsiMidpoint != null &&
            prevRsi > rsiOverbought &&
            rsi < rsiOverbought &&
            rsi >= rsiMidpoint
        ) {
            alerts.push(createAlert("🔄 RSI neutral (de >70)", ALERT_LEVELS.LOW, ALERT_CATEGORIES.MOMENTUM));
        }
        if (
            rsiOversold != null && rsiMidpoint != null &&
            prevRsi < rsiOversold &&
            rsi > rsiOversold &&
            rsi <= rsiMidpoint
        ) {
            alerts.push(createAlert("🔄 RSI neutral (de <30)", ALERT_LEVELS.LOW, ALERT_CATEGORIES.MOMENTUM));
        }
        if (rsiMidpoint != null && prevRsi < rsiMidpoint && rsi >= rsiMidpoint) {
            alerts.push(createAlert("📈 RSI crossed 50↑ (momentum shift)", ALERT_LEVELS.MEDIUM, ALERT_CATEGORIES.MOMENTUM));
        }
        if (rsiMidpoint != null && prevRsi > rsiMidpoint && rsi <= rsiMidpoint) {
            alerts.push(createAlert("📉 RSI crossed 50↓ (momentum shift)", ALERT_LEVELS.MEDIUM, ALERT_CATEGORIES.MOMENTUM));
        }
    }

    return alerts;
}
