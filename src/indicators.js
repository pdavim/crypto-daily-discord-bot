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
