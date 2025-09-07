import cron from "node-cron";
import { CFG } from "./config.js";
import { ASSETS, TIMEFRAMES } from "./assets.js";
import { fetchOHLCV, fetchDailyCloses } from "./data/binance.js";
import { sma, rsi, macd, bollinger, atr14, bollWidth } from "./indicators.js";
import { buildSnapshotForReport, buildSummary } from "./reporter.js";
import { postAnalysis, sendDiscordAlert } from "./discord.js";
import { postCharts } from "./discordBot.js";
import { renderChartPNG } from "./chart.js";
import { buildAlerts } from "./alerts.js";
import { runAgent } from "./ai.js";

function tfToInterval(tf) { return tf; }

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function runOnceForAsset(asset) {
    const daily = await fetchDailyCloses(asset.binance, 32);

    const snapshots = {};
    const chartPaths = [];

    for (const tf of TIMEFRAMES) {
        try {
            const candles = await fetchOHLCV(asset.binance, tfToInterval(tf));
            if (!candles || candles.length < 120) continue;

            const close = candles.map(c => c.c), vol = candles.map(c => c.v);

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

            const chartPath = await renderChartPNG(asset.key, tf, candles, {
                ma20, ma50, ma200,
                bbUpper: bb.upper,
                bbLower: bb.lower,
            });
            chartPaths.push(chartPath);

            // Alertas
            const alerts = buildAlerts({
                rsiSeries: r, macdObj: m, bbWidth: width,
                ma20, ma50,
                lastClose: snapshot.kpis.price,
                var24h: snapshot.kpis.var24h
            });
            const hasSignals = alerts.some(a => !a.startsWith("Preço") && !a.startsWith("Var24h"));
            if (hasSignals) {
                const mention = "@here";
                const alertMsg = [`**⚠️ Alertas — ${asset.key} ${tf}** ${mention}`, ...alerts.map(a => `• ${a}`)].join("\n");
                await sendDiscordAlert(alertMsg);
            }
        } catch (e) {
            console.error(`[${asset.key} ${tf}]`, e?.message || e);
        }
    }

    const summary = buildSummary({ assetKey: asset.key, snapshots });

    const sent = await postAnalysis(asset.key, "4h", summary);
    if (!sent) {
        console.warn(`[${asset.key}] report upload failed`);
    }

    await postCharts(chartPaths);
}

async function runAll() {
    const THROTTLE_MS = 1000; // adjust to respect upstream rate limits
    await Promise.all(
        ASSETS.map((a, i) => sleep(i * THROTTLE_MS).then(() => runOnceForAsset(a)))
    );
}

async function runDailyAnalysis() {
    try {
        const report = await runAgent();
        const sent = await postAnalysis("DAILY", "1d", report);
        if (!sent) {
            console.warn("[DAILY] report upload failed");
        }
    } catch (e) {
        console.error("[DAILY]", e?.message || e);
    }
}

const ONCE = process.argv.includes("--once");

if (!ONCE) {
    cron.schedule("0 * * * *", runAll, { timezone: CFG.tz });
    cron.schedule(`0 ${CFG.dailyReportHour} * * *`, runDailyAnalysis, { timezone: CFG.tz });
    console.log(`⏱️ Scheduled hourly (TZ=${CFG.tz})`);
    console.log(`⏱️ Scheduled daily at ${CFG.dailyReportHour}h (TZ=${CFG.tz})`);
    runAll();
    runDailyAnalysis();
} else {
    runAll();
    runDailyAnalysis();
}
