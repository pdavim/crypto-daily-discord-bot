import { crossUp, crossDown, isBBSqueeze } from "./indicators.js";

export function buildAlerts({
    rsiSeries, macdObj, bbWidth, ma20, ma50, ma200, lastClose, var24h, closes, highs, lows, volumes, atrSeries, upperBB, lowerBB, sarSeries, trendSeries, heuristicSeries, vwapSeries, ema9, ema21, stochasticK, stochasticD, willrSeries, cciSeries, obvSeries
}) {
    const alerts = [];

    const rsi = rsiSeries?.at(-1);
    const prevRsi = rsiSeries?.at(-2);
    const macd = macdObj?.macd?.at(-1);
    const macdSignal = macdObj?.signal?.at(-1);
    const macdHist = macdObj?.hist;
    const prevMacd = macdObj?.macd?.at(-2);
    const prevMacdSignal = macdObj?.signal?.at(-2);
    const price = lastClose;
    const prevPrice = closes?.at(-2);
    const high20 = Math.max(...highs?.slice(-20));
    const low20 = Math.min(...lows?.slice(-20));
    const avgVol = volumes?.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const lastVol = volumes?.at(-1);
    const atr = atrSeries?.at(-1);
    const prevAtr = atrSeries?.at(-2);
    const upper = upperBB?.at(-1);
    const lower = lowerBB?.at(-1);
    const prevSar = sarSeries?.at(-2);
    const sar = sarSeries?.at(-1);
    const trend = trendSeries?.at(-1);
    const heuristic = heuristicSeries?.at(-1);
    const vwap = vwapSeries?.at(-1);
    const prevVwap = vwapSeries?.at(-2);
    const ema9Val = ema9?.at(-1);
    const ema21Val = ema21?.at(-1);
    const prevEma9 = ema9?.at(-2);
    const prevEma21 = ema21?.at(-2);
    const stochK = stochasticK?.at(-1);
    const stochD = stochasticD?.at(-1);
    const willr = willrSeries?.at(-1);
    const cci = cciSeries?.at(-1);
    const obv = obvSeries?.at(-1);
    const prevObv = obvSeries?.at(-2);

    // Existing alerts
    if (rsi != null && rsi > 70) alerts.push("📉 RSI>70 (sobrecompra)");
    if (rsi != null && rsi < 30) alerts.push("📈 RSI<30 (sobrevenda)");
    if (prevRsi != null && rsi != null) {
        if (prevRsi > 70 && rsi <= 70) alerts.push("📉 RSI cross-back ↓ (70→<70)");
        if (prevRsi < 30 && rsi >= 30) alerts.push("📈 RSI cross-back ↑ (<30→>30)");
        if (prevRsi > 70 && rsi < 70 && rsi >= 50) alerts.push("🔄 RSI neutral (de >70)");
        if (prevRsi < 30 && rsi > 30 && rsi <= 50) alerts.push("🔄 RSI neutral (de <30)");
        if (prevRsi < 50 && rsi >= 50) alerts.push("📈 RSI crossed 50↑ (momentum shift)");
        if (prevRsi > 50 && rsi <= 50) alerts.push("📉 RSI crossed 50↓ (momentum shift)");
    }
    if (macd != null && macdSignal != null && prevMacd != null && prevMacdSignal != null) {
        if (prevMacd < prevMacdSignal && macd > macdSignal) alerts.push("📈 MACD bullish crossover");
        if (prevMacd > prevMacdSignal && macd < macdSignal) alerts.push("📉 MACD bearish crossover");
    }
    if (macdHist && crossUp(macdHist, Array(macdHist.length).fill(0))) alerts.push("📈 MACD flip ↑");
    if (macdHist && crossDown(macdHist, Array(macdHist.length).fill(0))) alerts.push("📉 MACD flip ↓");
    if (isBBSqueeze(bbWidth)) alerts.push("🧨 BB squeeze (compressão)");
    if (crossUp(ma20, ma50)) alerts.push("📈 Golden cross 20/50");
    if (crossDown(ma20, ma50)) alerts.push("📉 Death cross 20/50");
    // New alerts
    if (crossUp(ma50, ma200)) alerts.push("📈 Golden cross 50/200");
    if (crossDown(ma50, ma200)) alerts.push("📉 Death cross 50/200");
    if (price > ma20 && prevPrice <= ma20) alerts.push("📈 Price crossed above MA20");
    if (price < ma20 && prevPrice >= ma20) alerts.push("📉 Price crossed below MA20");
    if (price > ma50 && prevPrice <= ma50) alerts.push("📈 Price crossed above MA50");
    if (price < ma50 && prevPrice >= ma50) alerts.push("📉 Price crossed below MA50");
    if (price > ma200 && prevPrice <= ma200) alerts.push("📈 Price crossed above MA200");
    if (price < ma200 && prevPrice >= ma200) alerts.push("📉 Price crossed below MA200");
    if (price >= high20) alerts.push("🚀 New 20-period high");
    if (price <= low20) alerts.push("⚠️ New 20-period low");
    if (lastVol > 2 * avgVol) alerts.push("🔊 Volume spike (>2x avg)");
    if (atr > 1.5 * prevAtr) alerts.push("⚡ ATR spike (volatility)");
    if (price > upper) alerts.push("📈 BB breakout above");
    if (price < lower) alerts.push("📉 BB breakout below");
    if (prevSar < price && sar > price) alerts.push("📉 Parabolic SAR flip bearish");
    if (prevSar > price && sar < price) alerts.push("📈 Parabolic SAR flip bullish");
    if (trend != null && trend > 0.7) alerts.push("📈 Strong uptrend");
    if (trend != null && trend < -0.7) alerts.push("📉 Strong downtrend");
    if (heuristic != null && heuristic > 80) alerts.push("🌟 Heuristic score very high");
    if (heuristic != null && heuristic < 20) alerts.push("⚠️ Heuristic score very low");
    if (vwap != null && price > vwap && prevPrice <= prevVwap) alerts.push("📈 Price crossed above VWAP");
    if (vwap != null && price < vwap && prevPrice >= prevVwap) alerts.push("📉 Price crossed below VWAP");
    if (ema9Val != null && ema21Val != null && prevEma9 != null && prevEma21 != null) {
        if (prevEma9 < prevEma21 && ema9Val > ema21Val) alerts.push("📈 EMA 9/21 bullish crossover");
        if (prevEma9 > prevEma21 && ema9Val < ema21Val) alerts.push("📉 EMA 9/21 bearish crossover");
    }
    if (stochK != null && stochK > 80) alerts.push("📉 Stochastic overbought");
    if (stochK != null && stochK < 20) alerts.push("📈 Stochastic oversold");
    if (willr != null && willr > -20) alerts.push("📉 Williams %R overbought");
    if (willr != null && willr < -80) alerts.push("📈 Williams %R oversold");
    if (cci != null && cci > 100) alerts.push("📉 CCI overbought");
    if (cci != null && cci < -100) alerts.push("📈 CCI oversold");
    if (obv != null && prevObv != null && obv > prevObv * 1.05) alerts.push("📈 OBV bullish divergence");
    if (obv != null && prevObv != null && obv < prevObv * 0.95) alerts.push("📉 OBV bearish divergence");
    if (price % 1000 < 10) alerts.push("🔵 Price near round number");
    alerts.push(`💰 Preço: ${lastClose?.toFixed(4)}`);
    if (var24h != null) alerts.push(`📊 Var24h: ${var24h > 0 ? '+' : ''}${(var24h * 100).toFixed(2)}%`);
    return alerts;
}
