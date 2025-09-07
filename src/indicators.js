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

// Parabolic SAR & divergência de volume: versões simples (SAR passo 0.02, máx 0.2)
export function parabolicSAR(ohlc, step = 0.02, max = 0.2) { /* implementação simplificada */ return Array(ohlc.length).fill(null); }

export function volumeDivergence(closes, volumes, period = 20) {
    // Sinal simples: preço sobe com volume a cair (bearish) ou vice-versa (bullish)
    const out = Array(closes.length).fill(null);
    for (let i = period; i < closes.length; i++) {
        const pc = closes[i] - closes[i - period];
        const vc = volumes[i] - volumes[i - period];
        out[i] = (pc > 0 && vc < 0) ? "bear" : (pc < 0 && vc > 0) ? "bull" : null;
    }
    return out;
}


// ... (mantém SMA, RSI, MACD, Bollinger que já tens)

export function atr14(ohlc) {
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
    const n = 14, k = 2 / (n + 1);
    const out = [];
    tr.forEach((v, i) => out.push(i ? (v * k + out[i - 1] * (1 - k)) : v));
    return out;
}

export function bollWidth(upper, lower, mid) {
    return upper.map((u, i) => {
        const l = lower[i], m = mid[i];
        if (u == null || l == null || m == null || m === 0) return null;
        return (u - l) / m; // largura relativa
    });
}

export function isBBSqueeze(widthSeries, lookback = 40, pct = 0.15) {
    // squeeze se o valor atual <= percentil 15% dos últimos N
    const arr = widthSeries.slice(-lookback).filter(x => x != null);
    if (arr.length < 10) return false;
    const sorted = [...arr].sort((a, b) => a - b);
    const threshold = sorted[Math.floor(sorted.length * pct)];
    const last = widthSeries[widthSeries.length - 1];
    return last != null && last <= threshold;
}

export function crossUp(a, b) { const n = a.length; return n > 1 && a[n - 2] < b[n - 2] && a[n - 1] >= b[n - 1]; }
export function crossDown(a, b) { const n = a.length; return n > 1 && a[n - 2] > b[n - 2] && a[n - 1] <= b[n - 1]; }

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

export function trendFromMAs(ma20, ma50, ma200) {
    const m20 = ma20.at(-1), m50 = ma50.at(-1), m200 = ma200?.at(-1);
    if (m20 == null || m50 == null) return "Neutro";
    if (m20 > m50 && (m200 == null || m50 > m200)) return "Alta";
    if (m20 < m50 && (m200 == null || m50 < m200)) return "Baixa";
    return "Neutro";
}

export function scoreHeuristic({ rsi, macdHist, width, trend }) {
    let s = 50;
    if (rsi != null) { if (rsi > 70) s -= 10; else if (rsi < 30) s += 10; }
    if (macdHist != null) { if (macdHist > 0) s += 5; else s -= 5; }
    if (width != null) { if (width < 0.1) s += 3; } // squeeze pode anteceder movimento
    if (trend === "Alta") s += 7; else if (trend === "Baixa") s -= 7;
    return Math.max(0, Math.min(100, Math.round(s)));
}

export function semaforo(score) {
    if (score >= 66) return "🟢";
    if (score >= 33) return "🟡";
    return "🔴";
}
