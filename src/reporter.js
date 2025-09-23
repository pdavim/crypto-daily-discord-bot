import puppeteer from "puppeteer";
import { semaforo, scoreHeuristic, trendFromMAs, sparkline, parabolicSAR, volumeDivergence } from "./indicators.js";

let browserPromise;

async function getBrowser() {
    if (!browserPromise) {
        browserPromise = puppeteer.launch({
            headless: "new",
            args: ["--no-sandbox", "--disable-setuid-sandbox"]
        });
        const shutdown = async () => {
            try {
                const browser = await browserPromise;
                await browser.close();
            } catch (_) {
                // Ignore shutdown errors.
            }
        };
        process.once("exit", shutdown);
    }
    return browserPromise;
}

function escapeHtml(value = "") {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function summaryToHtml(summary, { assetKey, timeframe } = {}) {
    const titleParts = [];
    if (assetKey) titleParts.push(assetKey);
    if (timeframe) titleParts.push(timeframe);
    const title = titleParts.join(" • ") || "Análise";
    const escapedSummary = escapeHtml(summary ?? "");
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="utf-8">
    <title>${escapeHtml(title)}</title>
    <style>
        body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; margin: 24px; }
        h1 { font-size: 20px; margin-bottom: 16px; }
        pre { background: #f8f9fb; padding: 16px; border-radius: 8px; white-space: pre-wrap; font-size: 12px; line-height: 1.5; }
    </style>
 </head>
 <body>
    <h1>${escapeHtml(title)}</h1>
    <pre>${escapedSummary}</pre>
 </body>
</html>`;
}

export async function buildSummaryPdf(summary, options = {}) {
    if (!summary) {
        throw new Error("Cannot build PDF from empty summary");
    }
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
        await page.setContent(summaryToHtml(summary, options), { waitUntil: "domcontentloaded" });
        const pdf = await page.pdf({
            format: "A4",
            printBackground: true,
            margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" }
        });
        return pdf;
    } finally {
        await page.close();
    }
}

export function pct(v) { return v == null ? '—' : `${(v * 100).toFixed(2)}%`; }
export function num(v, p = 4) { return v == null ? '—' : `${(+v).toFixed(p)}`; }
export function fmt(n) { return n == null ? '—' : Intl.NumberFormat().format(n); }

export function buildSnapshotForReport({ candles, daily, ma20, ma50, ma100, ma200, rsi, macdObj, bb, kc, atr, adx, volSeries }) {
    const last = candles.at(-1);
    const closeSeries = candles.map(c => c.c);
    const spark = sparkline(closeSeries, 28);
    const prev = candles.at(-2);
    const varTf = (last?.c != null && prev?.c != null) ? (last.c / prev.c - 1) : null;

    const d = daily;
    const lastDaily = d.at(-1);
    const getReturn = ms => {
        if (!lastDaily) return null;
        const target = lastDaily.t.getTime() - ms;
        for (let i = d.length - 1; i >= 0; i--) {
            const t = d[i].t.getTime();
            if (t <= target) return lastDaily.c / d[i].c - 1;
        }
        return null;
    };
    const dayMs = 24 * 60 * 60 * 1000;
    const var24h = getReturn(dayMs);
    const var7d = getReturn(7 * dayMs);
    const var30d = getReturn(30 * dayMs);

    const sarSeries = parabolicSAR(candles);
    const sar = sarSeries.at(-1);
    const volDivSeries = volumeDivergence(closeSeries, volSeries);
    const volDiv = volDivSeries.at(-1);

    const rsiNow = rsi.at(-1);
    const macdHist = macdObj.hist.at(-1);
    const adxNow = adx?.at?.(-1) ?? null;
    const kcUpper = kc?.upper?.at?.(-1) ?? null;
    const kcLower = kc?.lower?.at?.(-1) ?? null;
    const kcMid = kc?.mid?.at?.(-1) ?? null;
    const price = last?.c ?? null;
    let kcState = null;
    if (price != null && kcUpper != null && kcLower != null) {
        kcState = price > kcUpper
            ? "Acima"
            : price < kcLower
                ? "Abaixo"
                : "Dentro";
    }
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
            bw, atr14: atr.at(-1), adx14: adxNow, kcUpper, kcLower, kcMid, kcState,
            vol: last.v, sar, volDiv, fearGreed: '—', trend, reco, sem, score, spark
        }
    };
}

export function buildSummary({ assetKey, snapshots }) {
    const s = snapshots;

    const dirEmoji = v => {
        if (v == null || v === '—') return '🟡';
        if (typeof v === 'string') {
            const val = v.toLowerCase();
            if (val.includes('alta')) return '📈';
            if (val.includes('baixa')) return '📉';
            return '🟡';
        }
        return v > 0 ? '📈' : v < 0 ? '📉' : '🟡';
    };

    const pctOf = (tf, key) => {
        const v = s[tf]?.kpis?.[key];
        return v == null ? '??' : `${dirEmoji(v)} ${pct(v)}`;
    };
    const numOf = (tf, key, p) => {
        const v = s[tf]?.kpis?.[key];
        return v == null ? '??' : `${dirEmoji(v)} ${num(v, p)}`;
    };
    const rawOf = (tf, key) => {
        const v = s[tf]?.kpis?.[key];
        return v == null ? '??' : v;
    };
    const adxOf = tf => {
        const v = s[tf]?.kpis?.adx14;
        if (v == null) return '??';
        const emoji = v >= 25 ? '💪' : v >= 20 ? '📈' : '🟡';
        return `${emoji} ${num(v, 0)}`;
    };
    const keltnerStateOf = tf => {
        const state = s[tf]?.kpis?.kcState;
        if (state == null) return '??';
        const emoji = state === 'Acima' ? '📈' : state === 'Abaixo' ? '📉' : '🟡';
        return `${emoji} ${state}`;
    };
    const trendOf = tf => {
        const v = s[tf]?.kpis?.trend;
        if (v == null) return '??';
        const label = typeof v === 'string'
            ? v
            : v > 0 ? 'Alta' : v < 0 ? 'Baixa' : 'Neutro';
        return `${dirEmoji(v)} ${label}`;
    };

    const lines = [
        `- **Asset name**: **${assetKey}**`,
        `- **Preço**: ${numOf('4h', 'price')}`,
        `- **Variação**:`,
        `-- 5m - ${pctOf('5m', 'var')} / 15m - ${pctOf('15m', 'var')} / 30m - ${pctOf('30m', 'var')} / 1h - ${pctOf('1h', 'var')} / 4h - ${pctOf('4h', 'var')} / 24h ${pctOf('4h', 'var24h')} / 7d ${pctOf('4h', 'var7d')} / 30d ${pctOf('4h', 'var30d')}`,
        `- **FearGreed**`,
        `-- 5m - ${rawOf('5m', 'fearGreed')} / 15m - ${rawOf('15m', 'fearGreed')} / 30m - ${rawOf('30m', 'fearGreed')} / 1h - ${rawOf('1h', 'fearGreed')} / 4h - ${rawOf('4h', 'fearGreed')}`,
        `- **Tendência**`,
        `-- 5m - ${trendOf('5m')} / 15m - ${trendOf('15m')} / 30m - ${trendOf('30m')} / 1h - ${trendOf('1h')} / 4h - ${trendOf('4h')}`,
        `- **Recomendação 🔁**`,
        `-- 5m - ${rawOf('5m', 'reco')} / 15m - ${rawOf('15m', 'reco')} / 30m - ${rawOf('30m', 'reco')} / 1h - ${rawOf('1h', 'reco')} / 4h - ${rawOf('4h', 'reco')}`,
        `- **Semáforo 🟡**`,
        `-- 5m - ${rawOf('5m', 'sem')} / 15m - ${rawOf('15m', 'sem')} / 30m - ${rawOf('30m', 'sem')} / 1h - ${rawOf('1h', 'sem')} / 4h - ${rawOf('4h', 'sem')}`,
        `- **Score**`,
        `-- 5m - ${numOf('5m', 'score', 0)} / 15m - ${numOf('15m', 'score', 0)} / 30m - ${numOf('30m', 'score', 0)} / 1h - ${numOf('1h', 'score', 0)} / 4h - ${numOf('4h', 'score', 0)}`,
        `- **ADX (14)**`,
        `-- 5m - ${adxOf('5m')} / 15m - ${adxOf('15m')} / 30m - ${adxOf('30m')} / 1h - ${adxOf('1h')} / 4h - ${adxOf('4h')}`,
        `- **Canal de Keltner**`,
        `-- 5m - ${keltnerStateOf('5m')} / 15m - ${keltnerStateOf('15m')} / 30m - ${keltnerStateOf('30m')} / 1h - ${keltnerStateOf('1h')} / 4h - ${keltnerStateOf('4h')}`
    ];

    lines.push("⚠️ *Esta análise é educativa e não constitui aconselhamento financeiro.*");
    return lines.join('\n');
}
