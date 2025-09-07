import { semaforo, scoreHeuristic, trendFromMAs, sparkline } from "./indicators.js";

export function pct(v) { return v == null ? '—' : `${(v * 100).toFixed(2)}%`; }
export function num(v, p = 4) { return v == null ? '—' : `${(+v).toFixed(p)}`; }
export function fmt(n) { return n == null ? '—' : Intl.NumberFormat().format(n); }

export function buildSnapshotForReport({ candles, daily, ma20, ma50, ma100, ma200, rsi, macdObj, bb, atr, volSeries }) {
    const last = candles.at(-1);
    const closeSeries = candles.map(c => c.c);
    const spark = sparkline(closeSeries, 28);

    const d = daily;
    const lastD = d.at(-1)?.c, d1 = d.at(-2)?.c, d7 = d.at(-8)?.c, d30 = d.at(-31)?.c;
    const var24h = (lastD != null && d1 != null) ? (lastD / d1 - 1) : null;
    const var7d = (lastD != null && d7 != null) ? (lastD / d7 - 1) : null;
    const var30d = (lastD != null && d30 != null) ? (lastD / d30 - 1) : null;

    const rsiNow = rsi.at(-1);
    const macdHist = macdObj.hist.at(-1);
    const bw = (bb.upper.at(-1) != null && bb.lower.at(-1) != null && bb.mid.at(-1) != null)
        ? (bb.upper.at(-1) - bb.lower.at(-1)) / bb.mid.at(-1)
        : null;

    const trend = trendFromMAs(ma20, ma50, ma200);
    const score = scoreHeuristic({ rsi: rsiNow, macdHist, width: bw, trend });
    const sem = semaforo(score);
    const reco = (rsiNow < 30 && macdHist > 0) ? "Comprar (📈)" : (rsiNow > 70 && macdHist < 0) ? "Vender (📉)" : "Manter (🔁)";

    return {
        last,
        kpis: {
            price: last.c, var24h, var7d, var30d, rsi: rsiNow, macdHist,
            sma20: ma20.at(-1), sma50: ma50.at(-1), sma100: ma100.at(-1), sma200: ma200?.at(-1),
            bw, atr14: atr.at(-1), vol: last.v, fearGreed: '—', trend, reco, sem, score, spark
        }
    };
}

export function buildSummary({ assetKey, tf, snapshot }) {
    const k = snapshot.kpis;
    return [
        `### ${assetKey} — ${tf}`,
        `**Preço** ${num(k.price)}  •  **Var24h** ${pct(k.var24h)}  •  **Var7d** ${pct(k.var7d)}  •  **Var30d** ${pct(k.var30d)}`,
        `**RSI14** ${num(k.rsi, 2)}  •  **MACD_Hist** ${num(k.macdHist, 4)}  •  **SMA20/50/100/200** ${num(k.sma20, 2)}/${num(k.sma50, 2)}/${num(k.sma100, 2)}/${k.sma200 ? num(k.sma200, 2) : '—'}`,
        `**BollWidth** ${num(k.bw, 4)}  •  **ATR14** ${num(k.atr14, 4)}  •  **Volume** ${fmt(k.vol)}  •  **FearGreed** ${k.fearGreed}`,
        `**Tendência** ${k.trend}  •  **Recomendação** ${k.reco}  •  **Semáforo** ${k.sem}  •  **Score** ${k.score}/100`,
        `**Preço (sparkline)** ${k.spark}`
    ].join("\n");
}
