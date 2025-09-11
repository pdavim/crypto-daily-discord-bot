import cron from "node-cron";
import { CFG } from "./config.js";
import { ASSETS, TIMEFRAMES, BINANCE_INTERVALS } from "./assets.js";
import { fetchOHLCV, fetchDailyCloses } from "./data/binance.js";
import { sma, rsi, macd, bollinger, atr14, bollWidth } from "./indicators.js";
import { buildSnapshotForReport, buildSummary } from "./reporter.js";
import { postAnalysis, sendDiscordAlert } from "./discord.js";
import { postCharts } from "./discordBot.js";
import { renderChartPNG } from "./chart.js";
import { buildAlerts } from "./alerts.js";
import { runAgent } from "./ai.js";
import { getSignature, updateSignature, saveStore } from "./store.js";
import { fetchEconomicEvents } from "./data/economic.js";

function tfToInterval(tf) { return BINANCE_INTERVALS[tf] || tf; }

function build45mCandles(candles15m) {
    const out = [];
    for (let i = 0; i + 3 <= candles15m.length; i += 3) {
        const slice = candles15m.slice(i, i + 3);
        out.push({
            t: slice[0].t,
            o: slice[0].o,
            h: Math.max(...slice.map(c => c.h)),
            l: Math.min(...slice.map(c => c.l)),
            c: slice[slice.length - 1].c,
            v: slice.reduce((sum, c) => sum + c.v, 0)
        });
    }
    return out;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function buildCron(minute) {
    if (CFG.analysisFrequency === "twice-daily") {
        return `${minute} 0,12 * * *`;
    }
    return `${minute} * * * *`;
}

async function runOnceForAsset(asset) {
    const daily = await fetchDailyCloses(asset.binance, 32);
    const snapshots = {};
    const chartPaths = [];
    for (const tf of TIMEFRAMES) {
        try {
            let candles = await fetchOHLCV(asset.binance, tfToInterval(tf));
            if (tf === "45m") {
                candles = build45mCandles(candles);
            }
            const min = tf === "45m" ? 40 : 120;
            if (!candles || candles.length < min) continue;
            const lastCandleTime = candles.at(-1)?.t?.getTime?.();
            const key = `${asset.key}:${tf}`;
            if (lastCandleTime != null && getSignature(key) === lastCandleTime) {
                continue;
            }
            if (lastCandleTime != null) {
                updateSignature(key, lastCandleTime);
            }
            const close = candles.map(c => c.c), vol = candles.map(c => c.v), high = candles.map(c => c.h), low = candles.map(c => c.l);
            // Calculate indicators once
            const ma20 = sma(close, 20), ma50 = sma(close, 50), ma100 = sma(close, 100), ma200 = sma(close, 200);
            const r = rsi(close, 14);
            const m = macd(close, 12, 26, 9);
            const bb = bollinger(close, 20, 2);
            const atr = atr14(candles);
            const width = bollWidth(bb.upper, bb.lower, bb.mid);
            const snapshot = buildSnapshotForReport({
                candles, daily, ma20, ma50, ma100, ma200, rsi: r, macdObj: m, bb, atr, volSeries: vol
            });
            snapshots[tf] = snapshot;
            if (CFG.enableCharts) {
                const chartPath = await renderChartPNG(asset.key, tf, candles, {
                    ma20, ma50, ma200,
                    bbUpper: bb.upper,
                    bbLower: bb.lower,
                });
                chartPaths.push(chartPath);
            }
            if (CFG.enableAlerts) {
                const alerts = buildAlerts({
                    rsiSeries: r, macdObj: m, bbWidth: width,
                    ma20, ma50, ma200,
                    lastClose: snapshot.kpis.price,
                    var24h: snapshot.kpis.var24h,
                    closes: close, highs: high, lows: low, volumes: vol,
                    atrSeries: atr,
                    upperBB: bb.upper, lowerBB: bb.lower,
                    sarSeries: undefined, trendSeries: undefined, heuristicSeries: undefined,
                    vwapSeries: undefined, ema9: undefined, ema21: undefined, stochasticK: undefined, stochasticD: undefined, willrSeries: undefined, cciSeries: undefined, obvSeries: undefined,
                    equity: CFG.accountEquity,
                    riskPct: CFG.riskPerTrade
                });
                const hasSignals = alerts.some(a =>
                    !a.startsWith('💰 Preço') && !a.startsWith('📊 Var24h'));
                if (hasSignals) {
                    const mention = "@here";
                    const alertMsg = [`**⚠️ Alertas — ${asset.key} ${tf}** ${mention}`, ...alerts.map(a => `• ${a}`)].join("\n");
                    await sendDiscordAlert(alertMsg);
                }
            }
        } catch (e) {
            console.error(`[${asset.key} ${tf}]`, e?.message || e);
        }
    }
    saveStore();
    if (CFG.enableAnalysis && snapshots["4h"]) {
        const summary = buildSummary({ assetKey: asset.key, snapshots });
        const sent = await postAnalysis(asset.key, "4h", summary);
        if (!sent) {
            console.warn(`[${asset.key}] report upload failed`);
        }
    }
    if (CFG.enableCharts && chartPaths.length > 0) {
        const chartsSent = await postCharts(chartPaths);
        if (!chartsSent) {
            console.warn(`[${asset.key}] chart upload failed`);
        }
    }
}

async function runAll() {
    for (let i = 0; i < ASSETS.length; i++) {
        await runOnceForAsset(ASSETS[i]);
        if (i < ASSETS.length - 1) {
            await sleep(1000);
        }
    }
}

async function runDailyAnalysis() {
    try {
        const dailyCandles = await fetchDailyCloses(ASSETS[0].binance, 2);
        const lastTime = dailyCandles.at(-1)?.t?.getTime?.();
        const key = "DAILY:1d";
        if (lastTime != null && getSignature(key) === lastTime) {
            return;
        }
        if (lastTime != null) {
            updateSignature(key, lastTime);
            saveStore();
        }
        const report = await runAgent();
        const events = await fetchEconomicEvents();
        let finalReport = report;
        if (events.length > 0) {
            const fmt = d => new Date(d).toLocaleString("en-US", { timeZone: CFG.tz, hour12: false });
            const header = "**Upcoming high-impact economic events**";
            const lines = events.map(e => `- ${fmt(e.date)}: ${e.title} (${e.country})`);
            finalReport = [header, ...lines, "", report].join("\n");
        }
        if (CFG.enableReports) {
            const sent = await postAnalysis("DAILY", "1d", finalReport);
            if (!sent) {
                console.warn("[DAILY] report upload failed");
            }
        }
    } catch (e) {
        console.error("[DAILY]", e?.message || e);
    }
}

const ONCE = process.argv.includes("--once");

if (!ONCE) {
    ASSETS.forEach((asset, idx) => {
        const minute = idx * 2;
        const pattern = buildCron(minute);
        cron.schedule(pattern, () => runOnceForAsset(asset), { timezone: CFG.tz });
        console.log(`⏱️ Scheduled ${asset.key} at '${pattern}' (TZ=${CFG.tz})`);
    });
    cron.schedule(`0 ${CFG.dailyReportHour} * * *`, runDailyAnalysis, { timezone: CFG.tz });
    console.log(`⏱️ Scheduled daily at ${CFG.dailyReportHour}h (TZ=${CFG.tz})`);
    runAll();
    runDailyAnalysis();
} else {
    runAll();
    runDailyAnalysis();
}
