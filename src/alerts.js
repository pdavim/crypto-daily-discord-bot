import { crossUp, crossDown, isBBSqueeze } from "./indicators.js";
import { atrStopTarget, positionSize } from "./trading/risk.js";
import { roundThreshold } from "./utils.js";
import { performance } from 'node:perf_hooks';
import { logger, withContext } from './logger.js';
import { recordPerf } from './perf.js';

const DEFAULT_THRESHOLDS = {
    rsi: { overbought: 70, oversold: 30, midpoint: 50 },
    adx: { strongTrend: 25 },
    volumeSpike: 2,
    atrSpike: 1.5,
    stochastic: { overbought: 80, oversold: 20 },
    williamsR: { overbought: -20, oversold: -80 },
    cci: { overbought: 100, oversold: -100 },
    heuristic: { high: 80, low: 20 },
    obv: { delta: 0.05 }
};

export function buildAlerts({
    rsiSeries, macdObj, bbWidth, ma20, ma50, ma200, lastClose, var24h, closes, highs, lows, volumes, atrSeries, upperBB, lowerBB, upperKC, lowerKC, adxSeries, sarSeries, trendSeries, heuristicSeries, vwapSeries, ema9, ema21, stochasticK, stochasticD, willrSeries, cciSeries, obvSeries,
    equity,
    riskPct
}) {
    const start = performance.now();
    const alerts = [];
    const thresholds = DEFAULT_THRESHOLDS;
    const rsiThresholds = thresholds.rsi;

    const rsi = rsiSeries?.at(-1);
    const prevRsi = rsiSeries?.at(-2);
    const macd = macdObj?.macd?.at(-1);
    const macdSignal = macdObj?.signal?.at(-1);
    const macdHist = macdObj?.hist;
    const prevMacd = macdObj?.macd?.at(-2);
    const prevMacdSignal = macdObj?.signal?.at(-2);
    const price = lastClose;
    const prevPrice = closes?.at(-2);
    const adxVal = adxSeries?.at(-1);
    const high20 = Math.max(...highs?.slice(-20));
    const low20 = Math.min(...lows?.slice(-20));
    const last20Vol = volumes?.slice(-20);
    const avgVol = last20Vol?.length === 20 ? last20Vol.reduce((a, b) => a + b, 0) / 20 : undefined;
    const lastVol = volumes?.at(-1);
    const atr = atrSeries?.at(-1);
    const prevAtr = atrSeries?.at(-2);
    const upper = upperBB?.at(-1);
    const lower = lowerBB?.at(-1);
    const upperKeltner = upperKC?.at(-1);
    const lowerKeltner = lowerKC?.at(-1);
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
    if (rsi != null && rsi > rsiThresholds.overbought) alerts.push("📉 RSI>70 (sobrecompra)");
    if (rsi != null && rsi < rsiThresholds.oversold) alerts.push("📈 RSI<30 (sobrevenda)");
    if (prevRsi != null && rsi != null) {
        if (prevRsi > rsiThresholds.overbought && rsi <= rsiThresholds.overbought) alerts.push("📉 RSI cross-back ↓ (70→<70)");
        if (prevRsi < rsiThresholds.oversold && rsi >= rsiThresholds.oversold) alerts.push("📈 RSI cross-back ↑ (<30→>30)");
        if (prevRsi > rsiThresholds.overbought && rsi < rsiThresholds.overbought && rsi >= rsiThresholds.midpoint) alerts.push("🔄 RSI neutral (de >70)");
        if (prevRsi < rsiThresholds.oversold && rsi > rsiThresholds.oversold && rsi <= rsiThresholds.midpoint) alerts.push("🔄 RSI neutral (de <30)");
        if (prevRsi < rsiThresholds.midpoint && rsi >= rsiThresholds.midpoint) alerts.push("📈 RSI crossed 50↑ (momentum shift)");
        if (prevRsi > rsiThresholds.midpoint && rsi <= rsiThresholds.midpoint) alerts.push("📉 RSI crossed 50↓ (momentum shift)");
    }
    if (macd != null && macdSignal != null && prevMacd != null && prevMacdSignal != null) {
        if (prevMacd < prevMacdSignal && macd > macdSignal) alerts.push("📈 MACD bullish crossover");
        if (prevMacd > prevMacdSignal && macd < macdSignal) alerts.push("📉 MACD bearish crossover");
    }
    if (macdHist && crossUp(macdHist, Array(macdHist.length).fill(0))) alerts.push("📈 MACD flip ↑");
    if (macdHist && crossDown(macdHist, Array(macdHist.length).fill(0))) alerts.push("📉 MACD flip ↓");
    if (isBBSqueeze(bbWidth)) alerts.push("🧨 BB squeeze (compressão)");
    if (adxVal != null && adxVal >= thresholds.adx.strongTrend) alerts.push("💪 ADX>25 (tendência forte)");
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
    if (avgVol && lastVol > thresholds.volumeSpike * avgVol) alerts.push("🔊 Volume spike (>2x avg)");
    if (prevAtr != null && atr != null && atr > thresholds.atrSpike * prevAtr) alerts.push("⚡ ATR spike (volatility)");
    if (price > upper) alerts.push("📈 BB breakout above");
    if (price < lower) alerts.push("📉 BB breakout below");
    if (price > upperKeltner) alerts.push("📈 KC breakout above");
    if (price < lowerKeltner) alerts.push("📉 KC breakout below");
    if (prevSar < price && sar > price) alerts.push("📉 Parabolic SAR flip bearish");
    if (prevSar > price && sar < price) alerts.push("📈 Parabolic SAR flip bullish");
    if (trend === 1) alerts.push("📈 Strong uptrend");
    if (trend === -1) alerts.push("📉 Strong downtrend");
    if (heuristic != null && heuristic > thresholds.heuristic.high) alerts.push("🌟 Heuristic score very high");
    if (heuristic != null && heuristic < thresholds.heuristic.low) alerts.push("⚠️ Heuristic score very low");
    if (vwap != null && price > vwap && prevPrice <= prevVwap) alerts.push("📈 Price crossed above VWAP");
    if (vwap != null && price < vwap && prevPrice >= prevVwap) alerts.push("📉 Price crossed below VWAP");
    if (ema9Val != null && ema21Val != null && prevEma9 != null && prevEma21 != null) {
        if (prevEma9 < prevEma21 && ema9Val > ema21Val) alerts.push("📈 EMA 9/21 bullish crossover");
        if (prevEma9 > prevEma21 && ema9Val < ema21Val) alerts.push("📉 EMA 9/21 bearish crossover");
    }
    if (stochK != null && stochK > thresholds.stochastic.overbought) alerts.push("📉 Stochastic overbought");
    if (stochK != null && stochK < thresholds.stochastic.oversold) alerts.push("📈 Stochastic oversold");
    if (willr != null && willr > thresholds.williamsR.overbought) alerts.push("📉 Williams %R overbought");
    if (willr != null && willr < thresholds.williamsR.oversold) alerts.push("📈 Williams %R oversold");
    if (cci != null && cci > thresholds.cci.overbought) alerts.push("📉 CCI overbought");
    if (cci != null && cci < thresholds.cci.oversold) alerts.push("📈 CCI oversold");
    if (obv != null && prevObv != null && obv > prevObv * (1 + thresholds.obv.delta)) alerts.push("📈 OBV bullish divergence");
    if (obv != null && prevObv != null && obv < prevObv * (1 - thresholds.obv.delta)) alerts.push("📉 OBV bearish divergence");
    const threshold = roundThreshold(price);
    if (price % threshold < threshold / 100) alerts.push("🔵 Price near round number");
    alerts.push(`💰 Preço: ${lastClose?.toFixed(4)}`);
    if (var24h != null) alerts.push(`📊 Var24h: ${var24h > 0 ? '+' : ''}${(var24h * 100).toFixed(2)}%`);
    if (equity != null && atr != null && price != null && riskPct != null) {
        const { stop, target } = atrStopTarget(price, atr);
        const size = positionSize(equity, riskPct, price, stop);
        if (stop != null && target != null) {
            alerts.push(`🎯 Stop ${stop.toFixed(4)} / Target ${target.toFixed(4)} / Size ${size.toFixed(4)}`);
        }
    }
    const ms = performance.now() - start;
    const log = withContext(logger);
    log.debug({ fn: 'buildAlerts', ms }, 'duration');
    recordPerf('buildAlerts', ms);
    return alerts;
}
