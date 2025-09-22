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
        alerts.push("📉 RSI>70 (sobrecompra)");
    }
    if (rsi != null && rsiOversold != null && rsi < rsiOversold) {
        alerts.push("📈 RSI<30 (sobrevenda)");
    }
    if (prevRsi != null && rsi != null) {
        if (rsiOverbought != null && prevRsi > rsiOverbought && rsi <= rsiOverbought) {
            alerts.push("📉 RSI cross-back ↓ (70→<70)");
        }
        if (rsiOversold != null && prevRsi < rsiOversold && rsi >= rsiOversold) {
            alerts.push("📈 RSI cross-back ↑ (<30→>30)");
        }
        if (
            rsiOverbought != null && rsiMidpoint != null &&
            prevRsi > rsiOverbought &&
            rsi < rsiOverbought &&
            rsi >= rsiMidpoint
        ) {
            alerts.push("🔄 RSI neutral (de >70)");
        }
        if (
            rsiOversold != null && rsiMidpoint != null &&
            prevRsi < rsiOversold &&
            rsi > rsiOversold &&
            rsi <= rsiMidpoint
        ) {
            alerts.push("🔄 RSI neutral (de <30)");
        }
        if (rsiMidpoint != null && prevRsi < rsiMidpoint && rsi >= rsiMidpoint) {
            alerts.push("📈 RSI crossed 50↑ (momentum shift)");
        }
        if (rsiMidpoint != null && prevRsi > rsiMidpoint && rsi <= rsiMidpoint) {
            alerts.push("📉 RSI crossed 50↓ (momentum shift)");
        }
    }

    return alerts;
}
