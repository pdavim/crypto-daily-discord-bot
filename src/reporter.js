import { semaforo, scoreHeuristic, trendFromMAs, sparkline } from "./indicators.js";

export function pct(v) { return v == null ? '—' : `${(v * 100).toFixed(2)}%`; }
export function num(v, p = 4) { return v == null ? '—' : `${(+v).toFixed(p)}`; }
export function fmt(n) { return n == null ? '—' : Intl.NumberFormat().format(n); }

export function buildSnapshotForReport({ candles, daily, ma20, ma50, ma100, ma200, rsi, macdObj, bb, atr, volSeries }) {
    const last = candles.at(-1);
    const closeSeries = candles.map(c => c.c);
    const spark = sparkline(closeSeries, 28);
    const prev = candles.at(-2);
    const varTf = (last?.c != null && prev?.c != null) ? (last.c / prev.c - 1) : null;

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
            price: last.c, var24h, var7d, var30d, var: varTf, rsi: rsiNow, macdHist,
            sma20: ma20.at(-1), sma50: ma50.at(-1), sma100: ma100.at(-1), sma200: ma200?.at(-1),
            bw, atr14: atr.at(-1), vol: last.v, fearGreed: '—', trend, reco, sem, score, spark
        }
    };
}

export function buildSummary({ assetKey, snapshots }) {
    const s = snapshots;

    const pctOf = (tf, key) => {
        const v = s[tf]?.kpis?.[key];
        return v == null ? '??' : pct(v);
        };
    const numOf = (tf, key, p) => {
        const v = s[tf]?.kpis?.[key];
        return v == null ? '??' : num(v, p);
        };
    const rawOf = (tf, key) => {
        const v = s[tf]?.kpis?.[key];
        return v == null ? '??' : v;
        };

    const lines = [
        `- Asset name: ${assetKey}`,
        `- Preço: ${numOf('4h', 'price')}`,
        `- Variação:`,
        `-- 5m - ${pctOf('5m', 'var')} / 15m - ${pctOf('15m', 'var')} / 30m - ${pctOf('30m', 'var')} / 1h - ${pctOf('1h', 'var')} / 4h - ${pctOf('4h', 'var')} / 24h ${pctOf('4h', 'var24h')} / 7d ${pctOf('4h', 'var7d')} / 30d ${pctOf('4h', 'var30d')}`,
        `- FearGreed`,
        `-- 5m - ${rawOf('5m', 'fearGreed')} / 15m - ${rawOf('15m', 'fearGreed')} / 30m - ${rawOf('30m', 'fearGreed')} / 1h - ${rawOf('1h', 'fearGreed')} / 4h - ${rawOf('4h', 'fearGreed')}`,
        `- Tendência`,
        `-- 5m - ${rawOf('5m', 'trend')} / 15m - ${rawOf('15m', 'trend')} / 30m - ${rawOf('30m', 'trend')} / 1h - ${rawOf('1h', 'trend')} / 4h - ${rawOf('4h', 'trend')}`,
        `- Recomendação 🔁`,
        `-- 5m - ${rawOf('5m', 'reco')} / 15m - ${rawOf('15m', 'reco')} / 30m - ${rawOf('30m', 'reco')} / 1h - ${rawOf('1h', 'reco')} / 4h - ${rawOf('4h', 'reco')}`,
        `- Semáforo 🟡`,
        `-- 5m - ${rawOf('5m', 'sem')} / 15m - ${rawOf('15m', 'sem')} / 30m - ${rawOf('30m', 'sem')} / 1h - ${rawOf('1h', 'sem')} / 4h - ${rawOf('4h', 'sem')}`,
        `- Score`,
        `-- 5m - ${numOf('5m', 'score', 0)} / 15m - ${numOf('15m', 'score', 0)} / 30m - ${numOf('30m', 'score', 0)} / 1h - ${numOf('1h', 'score', 0)} / 4h - ${numOf('4h', 'score', 0)}`
    ];

    return lines.join('\n');
}
