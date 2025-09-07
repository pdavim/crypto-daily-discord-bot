import { crossUp, crossDown, isBBSqueeze } from "./indicators.js";

export function buildAlerts({
    rsiSeries, macdObj, bbWidth, ma20, ma50, lastClose, var24h
}) {
    const alerts = [];

    const rsi = rsiSeries.at(-1);
    const prevRsi = rsiSeries.at(-2);

    if (rsi != null && rsi > 70) alerts.push("📉 RSI>70 (sobrecompra)");
    if (rsi != null && rsi < 30) alerts.push("📈 RSI<30 (sobrevenda)");

    if (prevRsi != null && rsi != null) {
        if (prevRsi > 70 && rsi <= 70) alerts.push("📉 RSI cross-back ↓ (70→<70)");
        if (prevRsi < 30 && rsi >= 30) alerts.push("📈 RSI cross-back ↑ (<30→>30)");
        if (prevRsi > 70 && rsi < 70 && rsi >= 50) alerts.push("🔄 RSI neutral (de >70)");
        if (prevRsi < 30 && rsi > 30 && rsi <= 50) alerts.push("🔄 RSI neutral (de <30)");
    }

    const h = macdObj.hist;
    if (crossUp(h, Array(h.length).fill(0))) alerts.push("📈 MACD flip ↑");
    if (crossDown(h, Array(h.length).fill(0))) alerts.push("📉 MACD flip ↓");

    if (isBBSqueeze(bbWidth)) alerts.push("🧨 BB squeeze (compressão)");

    if (crossUp(ma20, ma50)) alerts.push("📈 Golden cross 20/50");
    if (crossDown(ma20, ma50)) alerts.push("📉 Death cross 20/50");

    alerts.push(`💰 Preço: ${lastClose.toFixed(4)}`);
    if (var24h != null) alerts.push(`📊 Var24h: ${var24h > 0 ? '+' : ''}${(var24h * 100).toFixed(2)}%`);

    return alerts;
}
