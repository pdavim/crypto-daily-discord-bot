/**
 * Calculates the simple moving average for the provided series.
 * @param {number[]} arr - Values to average.
 * @param {number} period - Window length used for the average.
 * @returns {Array<number>} Array containing the SMA values aligned with the input; positions without enough data remain null.
 */
export function sma(arr, period) {
    const out = Array(arr.length).fill(null);
    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
        sum += arr[i];
        if (i >= period) sum -= arr[i - period];
        if (i >= period - 1) out[i] = sum / period;
    }
    return out;
}

/**
 * Computes the relative strength index (RSI) for a series of closing prices.
 * @param {number[]} closes - Closing price series.
 * @param {number} [period=14] - Lookback period for the indicator.
 * @returns {Array<number>} RSI values where unavailable entries are null.
 */
export function rsi(closes, period = 14) {
    const out = Array(closes.length).fill(null);
    let gains = 0, losses = 0;
    for (let i = 1; i < closes.length; i++) {
        const d = closes[i] - closes[i - 1];
        if (i <= period) {
            if (d > 0) gains += d; else losses -= d;
            if (i === period) {
                let avgG = gains / period, avgL = losses / period;
                const rs = avgL === 0 ? 100 : avgG / avgL;
                out[i] = 100 - (100 / (1 + rs));
                var prevG = avgG, prevL = avgL;
            }
        } else {
            const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
            prevG = (prevG * (period - 1) + g) / period;
            prevL = (prevL * (period - 1) + l) / period;
            const rs = prevL === 0 ? 100 : prevG / prevL;
            out[i] = 100 - (100 / (1 + rs));
        }
    }
    return out;
}

// MACD (12,26,9)
/**
 * Calculates the Moving Average Convergence Divergence (MACD) indicator.
 * @param {number[]} closes - Closing prices used to compute the MACD.
 * @param {number} [fast=12] - Fast EMA period.
 * @param {number} [slow=26] - Slow EMA period.
 * @param {number} [signal=9] - Signal line EMA period.
 * @returns {Object} MACD components with line, signal and histogram arrays.
 */
export function macd(closes, fast = 12, slow = 26, signal = 9) {
    const ema = (p) => {
        const k = 2 / (p + 1); const out = []; let prev;
        closes.forEach((c, i) => { prev = i ? (c * k + prev * (1 - k)) : c; out.push(prev); });
        return out;
    };
    const fastE = ema(fast), slowE = ema(slow);
    const line = fastE.map((v, i) => v - slowE[i]);
    const signalE = (() => {
        const k = 2 / (signal + 1); const out = []; let prev;
        line.forEach((v, i) => { prev = i ? (v * k + prev * (1 - k)) : v; out.push(prev); }); return out;
    })();
    const hist = line.map((v, i) => v - signalE[i]);
    return { line, signal: signalE, hist };
}

/**
 * Calculates Bollinger Bands for the provided closing prices.
 * @param {number[]} closes - Closing price series.
 * @param {number} [period=20] - Length of the moving average.
 * @param {number} [mult=2] - Standard deviation multiplier for the bands.
 * @returns {Object} Bollinger band values containing middle, upper and lower arrays.
 */
export function bollinger(closes, period = 20, mult = 2) {
    const ma = sma(closes, period);
    const out = { mid: ma, upper: Array(closes.length).fill(null), lower: Array(closes.length).fill(null) };
    for (let i = 0; i < closes.length; i++) {
        if (i >= period - 1) {
            const slice = closes.slice(i - period + 1, i + 1);
            const mean = ma[i];
            const std = Math.sqrt(slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / slice.length);
            out.upper[i] = mean + mult * std;
            out.lower[i] = mean - mult * std;
        }
    }
    return out;
}

/**
 * Calculates Keltner Channels for the provided price series.
 * @param {number[]} closes - Closing prices.
 * @param {number[]} highs - High prices aligned with closes.
 * @param {number[]} lows - Low prices aligned with closes.
 * @param {number} [period=20] - Lookback period for the EMA and ATR.
 * @param {number} [multiplier=2] - Multiplier applied to the ATR for the band width.
 * @returns {Object} Channel values containing middle, upper and lower arrays.
 */
export function keltnerChannel(closes, highs, lows, period = 20, multiplier = 2) {
    const len = Math.min(closes?.length ?? 0, highs?.length ?? 0, lows?.length ?? 0);
    const out = {
        mid: Array(len).fill(null),
        upper: Array(len).fill(null),
        lower: Array(len).fill(null)
    };
    if (!len) return out;

    const typical = Array(len);
    for (let i = 0; i < len; i++) {
        typical[i] = (highs[i] + lows[i] + closes[i]) / 3;
    }
    const midEma = ema(typical, period);

    const tr = Array(len).fill(0);
    for (let i = 0; i < len; i++) {
        if (i === 0) {
            tr[i] = highs[i] - lows[i];
        } else {
            const prevClose = closes[i - 1];
            const range = highs[i] - lows[i];
            const highClose = Math.abs(highs[i] - prevClose);
            const lowClose = Math.abs(lows[i] - prevClose);
            tr[i] = Math.max(range, highClose, lowClose);
        }
    }
    const atrEma = ema(tr, period);

    for (let i = 0; i < len; i++) {
        if (i < period - 1) continue;
        const mid = midEma[i];
        const atr = atrEma[i];
        out.mid[i] = mid;
        out.upper[i] = mid + multiplier * atr;
        out.lower[i] = mid - multiplier * atr;
    }

    return out;
}

// Parabolic SAR (passo padrão 0.02, aceleração máx 0.2)
/**
 * Computes the Parabolic SAR trend indicator for OHLC candles.
 * @param {Array<Object>} ohlc - Candle data including high, low and close.
 * @param {number} [step=0.02] - Acceleration factor step.
 * @param {number} [max=0.2] - Maximum acceleration factor.
 * @returns {Array<number>} Parabolic SAR values for each candle.
 */
export function parabolicSAR(ohlc, step = 0.02, max = 0.2) {
    const out = Array(ohlc.length).fill(null);
    if (!ohlc || ohlc.length < 2) return out;

    let up = ohlc[1].c > ohlc[0].c; // tendência inicial
    let sar = up ? ohlc[0].l : ohlc[0].h;
    let ep = up ? Math.max(ohlc[0].h, ohlc[1].h) : Math.min(ohlc[0].l, ohlc[1].l);
    let af = step;

    out[1] = sar;

    for (let i = 2; i < ohlc.length; i++) {
        sar = sar + af * (ep - sar);

        if (up) {
            sar = Math.min(sar, ohlc[i - 1].l, ohlc[i - 2].l);
            if (ohlc[i].h > ep) {
                ep = ohlc[i].h;
                af = Math.min(af + step, max);
            }
            if (sar > ohlc[i].l) { // reversão para baixa
                up = false;
                sar = Math.max(ep, ohlc[i - 1].h, ohlc[i - 2].h);
                ep = ohlc[i].l;
                af = step;
            }
        } else {
            sar = Math.max(sar, ohlc[i - 1].h, ohlc[i - 2].h);
            if (ohlc[i].l < ep) {
                ep = ohlc[i].l;
                af = Math.min(af + step, max);
            }
            if (sar < ohlc[i].h) { // reversão para alta
                up = true;
                sar = Math.min(ep, ohlc[i - 1].l, ohlc[i - 2].l);
                ep = ohlc[i].h;
                af = step;
            }
        }
        out[i] = sar;
    }

    return out;
}

// Divergência de volume normalizada por EMA
/**
 * Detects bullish or bearish volume divergence against the price series.
 * @param {number[]} closes - Closing prices.
 * @param {number[]} volumes - Volume series aligned with closes.
 * @param {number} [period=20] - EMA period used for normalization.
 * @returns {Array<string|null>} Divergence labels per candle.
 */
export function volumeDivergence(closes, volumes, period = 20) {
    const out = Array(closes.length).fill(null);
    if (!closes || closes.length !== volumes.length) return out;

    const ema = (arr, p) => {
        const k = 2 / (p + 1);
        const res = [];
        let prev;
        arr.forEach((v, i) => { prev = i ? (v * k + prev * (1 - k)) : v; res.push(prev); });
        return res;
    };

    const pEma = ema(closes, period);
    const vEma = ema(volumes, period);

    for (let i = period; i < closes.length; i++) {
        const pRel = pEma[i] ? (closes[i] - pEma[i]) / pEma[i] : 0;
        const vRel = vEma[i] ? (volumes[i] - vEma[i]) / vEma[i] : 0;
        if (pRel > 0 && vRel < 0) out[i] = "bear";
        else if (pRel < 0 && vRel > 0) out[i] = "bull";
    }
    return out;
}

/**
 * Computes the Volume Weighted Average Price (VWAP).
 * @param {number[]} highs - High prices.
 * @param {number[]} lows - Low prices.
 * @param {number[]} closes - Closing prices.
 * @param {number[]} volumes - Trade volumes.
 * @returns {Array<number>} VWAP series aligned with the inputs.
 */
export function vwap(highs, lows, closes, volumes) {
    const out = Array(closes.length).fill(null);
    let cumPV = 0, cumVol = 0;
    for (let i = 0; i < closes.length; i++) {
        const tp = (highs[i] + lows[i] + closes[i]) / 3;
        const v = volumes[i];
        cumPV += tp * v;
        cumVol += v;
        out[i] = cumVol ? cumPV / cumVol : null;
    }
    return out;
}

/**
 * Calculates the exponential moving average of a numeric series.
 * @param {number[]} arr - Values to smooth.
 * @param {number} period - Lookback period for the EMA.
 * @returns {Array<number>} EMA values.
 */
export function ema(arr, period) {
    const k = 2 / (period + 1);
    const out = [];
    arr.forEach((val, i) => {
        if (i === 0) out.push(val);
        else out.push(val * k + out[i - 1] * (1 - k));
    });
    return out;
}

/**
 * Computes the Average Directional Index (ADX) from high, low and close series.
 * @param {number[]} highs - High price series.
 * @param {number[]} lows - Low price series.
 * @param {number[]} closes - Closing price series.
 * @param {number} [period=14] - Smoothing period for the calculation.
 * @returns {Array<number>} ADX values.
 */
export function adx(highs, lows, closes, period = 14) {
    const len = Math.min(highs?.length ?? 0, lows?.length ?? 0, closes?.length ?? 0);
    if (!len) return [];

    const plusDM = Array(len).fill(0);
    const minusDM = Array(len).fill(0);
    const tr = Array(len).fill(0);

    if (len > 0) {
        tr[0] = highs[0] - lows[0];
    }

    for (let i = 1; i < len; i++) {
        const upMove = highs[i] - highs[i - 1];
        const downMove = lows[i - 1] - lows[i];
        plusDM[i] = (upMove > downMove && upMove > 0) ? upMove : 0;
        minusDM[i] = (downMove > upMove && downMove > 0) ? downMove : 0;

        const range = highs[i] - lows[i];
        const rangeHigh = Math.abs(highs[i] - closes[i - 1]);
        const rangeLow = Math.abs(lows[i] - closes[i - 1]);
        tr[i] = Math.max(range, rangeHigh, rangeLow);
    }

    const wilderRMA = (values, p, seedWithSMA = false) => {
        const out = Array(values.length).fill(null);
        let prev = null;
        const alpha = 1 / p;
        if (seedWithSMA && values.length >= p) {
            let seed = 0;
            for (let i = 0; i < p; i++) seed += values[i] ?? 0;
            values = values.slice();
            for (let i = 0; i < p - 1; i++) values[i] = null;
            values[p - 1] = seed / p;
        }
        for (let i = 0; i < values.length; i++) {
            const v = values[i];
            if (v == null) continue;
            prev = prev == null ? v : prev + alpha * (v - prev);
            out[i] = prev;
        }
        return out;
    };

    const atr = wilderRMA(tr, period, true);
    const plusRma = wilderRMA(plusDM, period);
    const minusRma = wilderRMA(minusDM, period);

    const dx = Array(len).fill(null);
    for (let i = 0; i < len; i++) {
        const atrVal = atr[i];
        if (atrVal == null || atrVal === 0) continue;
        const plusVal = plusRma[i] ?? 0;
        const minusVal = minusRma[i] ?? 0;
        const plusDI = (plusVal / atrVal) * 100;
        const minusDI = (minusVal / atrVal) * 100;
        const denom = plusDI + minusDI;
        dx[i] = denom === 0 ? 0 : Math.abs(plusDI - minusDI) / denom * 100;
    }

    return wilderRMA(dx, period);
}

/**
 * Calculates the stochastic oscillator for the given price series.
 * @param {number[]} highs - High prices.
 * @param {number[]} lows - Low prices.
 * @param {number[]} closes - Closing prices.
 * @param {number} [kPeriod=14] - Lookback period for the %K line.
 * @param {number} [dPeriod=3] - Smoothing period for the %D line.
 * @returns {Object} Stochastic oscillator values with %K and %D arrays.
 */
export function stochastic(highs, lows, closes, kPeriod = 14, dPeriod = 3) {
    const k = Array(closes.length).fill(null);
    for (let i = 0; i < closes.length; i++) {
        if (i >= kPeriod - 1) {
            const hh = Math.max(...highs.slice(i - kPeriod + 1, i + 1));
            const ll = Math.min(...lows.slice(i - kPeriod + 1, i + 1));
            k[i] = hh === ll ? 0 : ((closes[i] - ll) / (hh - ll)) * 100;
        }
    }
    const d = Array(closes.length).fill(null);
    for (let i = 0; i < closes.length; i++) {
        if (i >= kPeriod - 1 + dPeriod - 1) {
            const slice = k.slice(i - dPeriod + 1, i + 1);
            if (slice.every(v => v != null)) {
                d[i] = slice.reduce((a, b) => a + b, 0) / dPeriod;
            }
        }
    }
    return { k, d };
}

/**
 * Computes the Williams %R oscillator for the given prices.
 * @param {number[]} highs - High prices.
 * @param {number[]} lows - Low prices.
 * @param {number[]} closes - Closing prices.
 * @param {number} [period=14] - Lookback period for the indicator.
 * @returns {Array<number>} Williams %R values.
 */
export function williamsR(highs, lows, closes, period = 14) {
    const out = Array(closes.length).fill(null);
    for (let i = 0; i < closes.length; i++) {
        if (i >= period - 1) {
            const hh = Math.max(...highs.slice(i - period + 1, i + 1));
            const ll = Math.min(...lows.slice(i - period + 1, i + 1));
            out[i] = hh === ll ? 0 : ((hh - closes[i]) / (hh - ll)) * -100;
        }
    }
    return out;
}

/**
 * Calculates the Commodity Channel Index (CCI) for the given prices.
 * @param {number[]} highs - High prices.
 * @param {number[]} lows - Low prices.
 * @param {number[]} closes - Closing prices.
 * @param {number} [period=20] - Lookback period for the indicator.
 * @returns {Array<number>} CCI values.
 */
export function cci(highs, lows, closes, period = 20) {
    const tp = highs.map((h, i) => (h + lows[i] + closes[i]) / 3);
    const smaTp = sma(tp, period);
    const out = Array(closes.length).fill(null);
    for (let i = 0; i < closes.length; i++) {
        if (i >= period - 1) {
            const slice = tp.slice(i - period + 1, i + 1);
            const mean = smaTp[i];
            const md = slice.reduce((sum, v) => sum + Math.abs(v - mean), 0) / period;
            out[i] = md === 0 ? 0 : (tp[i] - mean) / (0.015 * md);
        }
    }
    return out;
}

/**
 * Computes the On Balance Volume (OBV) cumulative indicator.
 * @param {number[]} closes - Closing prices.
 * @param {number[]} volumes - Volume series aligned with closes.
 * @returns {Array<number>} OBV values.
 */
export function obv(closes, volumes) {
    const out = [];
    for (let i = 0; i < closes.length; i++) {
        if (i === 0) { out.push(0); continue; }
        if (closes[i] > closes[i - 1]) out.push(out[i - 1] + volumes[i]);
        else if (closes[i] < closes[i - 1]) out.push(out[i - 1] - volumes[i]);
        else out.push(out[i - 1]);
    }
    return out;
}

/**
 * Calculates the Average True Range (ATR) using an EMA smoothing.
 * @param {Array<Object>} ohlc - Candle objects containing high, low and close.
 * @param {number} [period=14] - Period for the ATR smoothing.
 * @returns {Array<number>} ATR values.
 */
export function atr14(ohlc, period = 14) {
    const tr = [];
    for (let i = 0; i < ohlc.length; i++) {
        if (i === 0) { tr.push(ohlc[i].h - ohlc[i].l); continue; }
        const prevClose = ohlc[i - 1].c;
        const a = ohlc[i].h - ohlc[i].l;
        const b = Math.abs(ohlc[i].h - prevClose);
        const c = Math.abs(ohlc[i].l - prevClose);
        tr.push(Math.max(a, b, c));
    }
    // EMA ATR(14)
    const n = Number.isFinite(period) && period > 0 ? Math.round(period) : 14;
    const k = 2 / (n + 1);
    const out = [];
    tr.forEach((v, i) => out.push(i ? (v * k + out[i - 1] * (1 - k)) : v));
    return out;
}

/**
 * Computes the relative width of Bollinger Bands.
 * @param {Array<number>} upper - Upper band values.
 * @param {Array<number>} lower - Lower band values.
 * @param {Array<number>} mid - Middle band values.
 * @returns {Array<number>} Relative band width for each point.
 */
export function bollWidth(upper, lower, mid) {
    return upper.map((u, i) => {
        const l = lower[i], m = mid[i];
        if (u == null || l == null || m == null || m === 0) return null;
        return (u - l) / m; // largura relativa
    });
}

/**
 * Determines whether the current Bollinger Band width is in squeeze conditions.
 * @param {Array<number>} widthSeries - Bollinger band width values.
 * @param {number} [lookback=40] - Number of samples considered for the percentile.
 * @param {number} [pct=0.15] - Percentile threshold that defines a squeeze.
 * @returns {boolean} True when the latest value is below the configured percentile.
 */
export function isBBSqueeze(widthSeries, lookback = 40, pct = 0.15) {
    // squeeze se o valor atual <= percentil 15% dos últimos N
    const arr = widthSeries.slice(-lookback).filter(x => x != null);
    if (arr.length < 10) return false;
    const sorted = [...arr].sort((a, b) => a - b);
    const threshold = sorted[Math.floor(sorted.length * pct)];
    const last = widthSeries[widthSeries.length - 1];
    return last != null && last <= threshold;
}

/**
 * Checks whether series A crossed above series B between the last two samples.
 * @param {number[]} a - First series to evaluate.
 * @param {number[]} b - Second series to evaluate.
 * @returns {boolean} True when a cross-over occurred.
 */
export function crossUp(a, b) { const n = a.length; return n > 1 && a[n - 2] < b[n - 2] && a[n - 1] >= b[n - 1]; }
/**
 * Checks whether series A crossed below series B between the last two samples.
 * @param {number[]} a - First series to evaluate.
 * @param {number[]} b - Second series to evaluate.
 * @returns {boolean} True when a cross-under occurred.
 */
export function crossDown(a, b) { const n = a.length; return n > 1 && a[n - 2] > b[n - 2] && a[n - 1] <= b[n - 1]; }

/**
 * Generates a unicode sparkline from the provided values.
 * @param {number[]} values - Series to visualize.
 * @param {number} [points=20] - Number of trailing points to include.
 * @returns {string} Sparkline string.
 */
export function sparkline(values, points = 20) {
    const chars = "▁▂▃▄▅▆▇█";
    const arr = values.slice(-points);
    const min = Math.min(...arr), max = Math.max(...arr);
    if (max === min) return chars[0].repeat(arr.length);
    return arr.map(v => {
        const idx = Math.floor(((v - min) / (max - min)) * (chars.length - 1));
        return chars[idx];
    }).join("");
}

/**
 * Estimates trend direction from moving averages.
 * @param {Array<number>} ma20 - 20-period moving average series.
 * @param {Array<number>} ma50 - 50-period moving average series.
 * @param {Array<number>} [ma200] - 200-period moving average series.
 * @returns {number} 1 for bullish trend, -1 for bearish and 0 for neutral.
 */
export function trendFromMAs(ma20, ma50, ma200) {
    const m20 = ma20.at(-1), m50 = ma50.at(-1), m200 = ma200?.at(-1);
    if (m20 == null || m50 == null) return 0;
    if (m20 > m50 && (m200 == null || m50 > m200)) return 1;
    if (m20 < m50 && (m200 == null || m50 < m200)) return -1;
    return 0;
}

/**
 * Aggregates several indicators into a heuristic score.
 * @param {Object} params - Indicator inputs.
 * @param {number} [params.rsi]
 * @param {number} [params.macdHist]
 * @param {number} [params.width]
 * @param {number} [params.trend]
 * @returns {number} Score between 0 and 100.
 */
export function scoreHeuristic({ rsi, macdHist, width, trend }) {
    let s = 50;
    if (rsi != null) { if (rsi > 70) s -= 10; else if (rsi < 30) s += 10; }
    if (macdHist != null) { if (macdHist > 0) s += 5; else s -= 5; }
    if (width != null) { if (width < 0.1) s += 3; } // squeeze pode anteceder movimento
    if (trend != null) { if (trend > 0) s += 7; else if (trend < 0) s -= 7; }
    return Math.max(0, Math.min(100, Math.round(s)));
}

/**
 * Maps a heuristic score into a traffic light emoji.
 * @param {number} score - Score between 0 and 100.
 * @returns {string} Emoji representing bullish, neutral or bearish context.
 */
export function semaforo(score) {
    if (score >= 66) return "🟢";
    if (score >= 33) return "🟡";
    return "🔴";
}


// indicators list:
// - SMA (20,50,200)
// - RSI (14)
// - MACD (12,26,9)
// - Bollinger Bands (20,2) + width + squeeze
// - Parabolic SAR
// - Volume Divergence
// - ATR (14)
// - Trend from MAs
// - Heuristic Score (0-100) + semaforo
// - Sparkline of closes
// - atr14
// - bollWidth
// - isBBSqueeze
// - crossUp
// - crossDown
// - sparkline
// - trendFromMAs
// - scoreHeuristic
// - semaforo

// Example usage:
// const closes = [....]; // array of closing prices
// const volumes = [....]; // array of volumes
// const ohlc = [ {o,h,l,c,v}, ... ]; // array of OHLCV objects
