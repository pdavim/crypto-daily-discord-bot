import cron from "node-cron";
import { CFG } from "./config.js";
import { ASSETS, TIMEFRAMES, BINANCE_INTERVALS } from "./assets.js";
import { fetchOHLCV, fetchDailyCloses } from "./data/binance.js";
import { streamKlines } from "./data/binanceStream.js";
import { sma, rsi, macd, bollinger, atr14, bollWidth, vwap, ema, stochastic, williamsR, cci, obv } from "./indicators.js";
import { buildSnapshotForReport, buildSummary } from "./reporter.js";
import { postAnalysis, sendDiscordAlert } from "./discord.js";
import { postCharts, initBot } from "./discordBot.js";
import { renderChartPNG } from "./chart.js";
import { buildAlerts } from "./alerts.js";
import { runAgent } from "./ai.js";
import { getSignature, updateSignature, saveStore } from "./store.js";
import { fetchEconomicEvents } from "./data/economic.js";
import { logger, withContext, createContext } from "./logger.js";
import pLimit from "./limit.js";
import { buildHash, shouldSend } from "./alertCache.js";

initBot();

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


async function runOnceForAsset(asset) {
    const dailyPromise = fetchDailyCloses(asset.binance, 32);
    const snapshots = {};
    const chartPaths = [];
    await Promise.all(TIMEFRAMES.map(async tf => {
        const log = withContext(logger, createContext({ asset: asset.key, timeframe: tf }));
        try {
            let candles = await fetchOHLCV(asset.binance, tfToInterval(tf));
            if (tf === "45m") {
                candles = build45mCandles(candles);
            }
            const min = tf === "45m" ? 40 : 120;
            if (!candles || candles.length < min) return;
            const lastCandleTime = candles.at(-1)?.t?.getTime?.();
            const key = `${asset.key}:${tf}`;
            if (lastCandleTime != null && getSignature(key) === lastCandleTime) {
                return;
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
            const vwapSeries = vwap(high, low, close, vol);
            const ema9 = ema(close, 9);
            const ema21 = ema(close, 21);
            const { k: stochasticK, d: stochasticD } = stochastic(high, low, close, 14, 3);
            const willrSeries = williamsR(high, low, close, 14);
            const cciSeries = cci(high, low, close, 20);
            const obvSeries = obv(close, vol);
            const daily = await dailyPromise;
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
                    vwapSeries, ema9, ema21,
                    stochasticK, stochasticD,
                    willrSeries, cciSeries, obvSeries,
                    equity: CFG.accountEquity,
                    riskPct: CFG.riskPerTrade
                });
                const hasSignals = alerts.some(a =>
                    !a.startsWith('💰 Preço') && !a.startsWith('📊 Var24h'));
                if (hasSignals) {
                    const mention = "@here";
                    const alertMsg = [`**⚠️ Alertas — ${asset.key} ${tf}** ${mention}`, ...alerts.map(a => `• ${a}`)].join("\n");
                    const hash = buildHash(alertMsg);
                    const windowMs = CFG.alertDedupMinutes * 60 * 1000;
                    if (shouldSend(hash, windowMs)) {
                        await sendDiscordAlert(alertMsg);
                    }
                }
            }
        } catch (e) {
            log.error({ fn: 'runOnceForAsset', err: e }, 'Processing error');
        }
    }));
    saveStore();
    if (CFG.enableAnalysis && snapshots["4h"]) {
        const summary = buildSummary({ assetKey: asset.key, snapshots });
        const sent = await postAnalysis(asset.key, "4h", summary);
        if (!sent) {
            const log = withContext(logger, createContext({ asset: asset.key, timeframe: '4h' }));
            log.warn({ fn: 'runOnceForAsset' }, 'report upload failed');
        }
    }
    if (CFG.enableCharts && chartPaths.length > 0) {
        const chartsSent = await postCharts(chartPaths);
        if (!chartsSent) {
            const log = withContext(logger, createContext({ asset: asset.key }));
            log.warn({ fn: 'runOnceForAsset' }, 'chart upload failed');
        }
    }
}

async function runAll() {
    const limit = pLimit(3);
    await Promise.all(
        ASSETS.map(asset => limit(() => runOnceForAsset(asset)))
    );
}

async function runDailyAnalysis() {
    const log = withContext(logger, createContext({ asset: 'DAILY', timeframe: '1d' }));
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
                log.warn({ fn: 'runDailyAnalysis' }, 'report upload failed');
            }
        }
    } catch (e) {
        log.error({ fn: 'runDailyAnalysis', err: e }, 'Error in daily analysis');
    }
}

async function runWeeklyAnalysis() {
    const log = withContext(logger, createContext({ asset: 'WEEKLY', timeframe: '1w' }));
    try {
        const dailyCandles = await fetchDailyCloses(ASSETS[0].binance, 8);
        const lastTime = dailyCandles.at(-1)?.t?.getTime?.();
        const key = "WEEKLY:1w";
        const weekMs = 7 * 24 * 60 * 60 * 1000;
        const weekSig = lastTime != null ? Math.floor(lastTime / weekMs) : null;
        if (weekSig != null && getSignature(key) === weekSig) {
            return;
        }
        if (weekSig != null) {
            updateSignature(key, weekSig);
            saveStore();
        }
        const report = await runAgent();
        const lines = ["**Weekly performance (7d)**"];
        for (const asset of ASSETS) {
            try {
                const candles = await fetchDailyCloses(asset.binance, 8);
                const last = candles.at(-1);
                const prev = candles.at(-8);
                const pct = (last?.c != null && prev?.c != null)
                    ? ((last.c / prev.c - 1) * 100).toFixed(2)
                    : null;
                lines.push(`- ${asset.key}: ${pct != null ? pct + '%': 'n/a'}`);
            } catch (err) {
                lines.push(`- ${asset.key}: error`);
            }
        }
        const finalReport = [lines.join("\n"), report].join("\n\n");
        if (CFG.enableReports) {
            const sent = await postAnalysis("WEEKLY", "1w", finalReport);
            if (!sent) {
                log.warn({ fn: 'runWeeklyAnalysis' }, 'report upload failed');
            }
        }
    } catch (e) {
        log.error({ fn: 'runWeeklyAnalysis', err: e }, 'Error in weekly analysis');
    }
}

const ONCE = process.argv.includes("--once");

const runningAssets = new Set();
function scheduleRun(asset) {
    if (runningAssets.has(asset.key)) return;
    runningAssets.add(asset.key);
    runOnceForAsset(asset).finally(() => runningAssets.delete(asset.key));
}

if (!ONCE) {
    const intervals = Array.from(new Set(TIMEFRAMES.map(tf => tfToInterval(tf))));
    const pairs = [];
    ASSETS.forEach(a => intervals.forEach(i => pairs.push({ symbol: a.binance, interval: i })));
    streamKlines(pairs, (symbol) => {
        const asset = ASSETS.find(a => a.binance === symbol);
        if (asset) {
            scheduleRun(asset);
        }
    });
    const scheduleLog = withContext(logger, createContext());
    cron.schedule(`0 ${CFG.dailyReportHour} * * *`, runDailyAnalysis, { timezone: CFG.tz });
    scheduleLog.info({ fn: 'schedule' }, `⏱️ Scheduled daily at ${CFG.dailyReportHour}h (TZ=${CFG.tz})`);
    cron.schedule('0 18 * * 0', runWeeklyAnalysis, { timezone: CFG.tz });
    scheduleLog.info({ fn: 'schedule' }, `⏱️ Scheduled weekly at 18h Sunday (TZ=${CFG.tz})`);
    runAll();
    runDailyAnalysis();
    runWeeklyAnalysis();
} else {
    runAll();
    runDailyAnalysis();
    runWeeklyAnalysis();
}
