import cron from "node-cron";
import http from "http";
import { CFG } from "./config.js";
import { ASSETS, TIMEFRAMES, BINANCE_INTERVALS } from "./assets.js";
import { fetchOHLCV, fetchDailyCloses } from "./data/binance.js";
import { streamKlines } from "./data/binanceStream.js";
import { sma, rsi, macd, bollinger, atr14, bollWidth, vwap, ema, adx, stochastic, williamsR, cci, obv, keltnerChannel } from "./indicators.js";
import { buildSnapshotForReport, buildSummary } from "./reporter.js";
import { postAnalysis, sendDiscordAlert } from "./discord.js";
import { postCharts, initBot } from "./discordBot.js";
import { renderChartPNG } from "./chart.js";
import { buildAlerts, formatAlertMessage } from "./alerts.js";
import { runAgent } from "./ai.js";
import { getSignature, updateSignature, saveStore, getAlertHash, updateAlertHash, resetAlertHashes } from "./store.js";
import { fetchEconomicEvents } from "./data/economic.js";
import { logger, withContext } from "./logger.js";
import pLimit, { calcConcurrency } from "./limit.js";
import { buildHash, shouldSend, pruneOlderThan } from "./alertCache.js";
import { register } from "./metrics.js";
import { notifyOps } from "./monitor.js";
import { reportWeeklyPerf } from "./perf.js";

initBot({ onAnalysis: handleAnalysisSlashCommand });

const METRICS_PORT = process.env.METRICS_PORT || 3001;
http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/metrics') {
        res.setHeader('Content-Type', register.contentType);
        res.end(await register.metrics());
    } else {
        res.statusCode = 404;
        res.end('Not found');
    }
}).listen(METRICS_PORT, () => {
    const log = withContext(logger);
    log.info({ fn: 'metrics' }, `Metrics server listening on port ${METRICS_PORT}`);
});

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


async function runOnceForAsset(asset, options = {}) {
    const {
        enableCharts = CFG.enableCharts,
        enableAlerts = CFG.enableAlerts,
        enableAnalysis = CFG.enableAnalysis,
        postAnalysis: shouldPostAnalysis = enableAnalysis,
        postCharts: shouldPostCharts = enableCharts
    } = options;
    const dailyPromise = fetchDailyCloses(asset.binance, 32);
    const snapshots = {};
    const chartPaths = [];

    const intervalPromises = new Map();
    for (const tf of TIMEFRAMES) {
        const interval = tfToInterval(tf);
        if (!intervalPromises.has(interval)) {
            intervalPromises.set(interval, fetchOHLCV(asset.binance, interval));
        }
    }
    const intervalKeys = [...intervalPromises.keys()];
    const intervalResults = await Promise.all(intervalKeys.map(k => intervalPromises.get(k)));
    const candlesByInterval = new Map(intervalKeys.map((k, i) => [k, intervalResults[i]]));

    let cached45mCandles;
    const indicatorCache = new Map();

    const timeframeTasks = TIMEFRAMES.map(async tf => {
        const log = withContext(logger, { asset: asset.key, timeframe: tf });
        try {
            let candles;
            if (tf === "45m") {
                if (!cached45mCandles) {
                    const base = candlesByInterval.get(tfToInterval("15m"));
                    if (!base) {
                        return;
                    }
                    cached45mCandles = build45mCandles(base);
                }
                candles = cached45mCandles;
            } else {
                const interval = tfToInterval(tf);
                candles = candlesByInterval.get(interval);
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
            const close = candles.map(c => c.c);
            const vol = candles.map(c => c.v);
            const high = candles.map(c => c.h);
            const low = candles.map(c => c.l);

            const indicators = indicatorCache.get(tf) ?? (() => {
                const cfg = CFG.indicators;
                const ma20 = sma(close, cfg.smaPeriods.ma20);
                const ma50 = sma(close, cfg.smaPeriods.ma50);
                const ma100 = sma(close, cfg.smaPeriods.ma100);
                const ma200 = sma(close, cfg.smaPeriods.ma200);
                const rsiSeries = rsi(close, cfg.rsiPeriod);
                const macdObj = macd(close, cfg.macd.fast, cfg.macd.slow, cfg.macd.signal);
                const bb = bollinger(close, cfg.bollinger.period, cfg.bollinger.multiplier);
                const kc = keltnerChannel(close, high, low, cfg.keltner.period, cfg.keltner.multiplier);
                const adxSeries = adx(high, low, close, cfg.adxPeriod);
                const atrSeries = atr14(candles, cfg.atrPeriod);
                const bbWidth = bollWidth(bb.upper, bb.lower, bb.mid);
                const vwapSeries = vwap(high, low, close, vol);
                const ema9Series = ema(close, cfg.emaPeriods.ema9);
                const ema21Series = ema(close, cfg.emaPeriods.ema21);
                const { k: stochasticK, d: stochasticD } = stochastic(high, low, close, cfg.stochastic.kPeriod, cfg.stochastic.dPeriod);
                const willrSeries = williamsR(high, low, close, cfg.williamsPeriod);
                const cciSeries = cci(high, low, close, cfg.cciPeriod);
                const obvSeries = obv(close, vol);
                const computed = {
                    ma20,
                    ma50,
                    ma100,
                    ma200,
                    rsiSeries,
                    macdObj,
                    bb,
                    kc,
                    adxSeries,
                    atrSeries,
                    bbWidth,
                    vwapSeries,
                    ema9Series,
                    ema21Series,
                    stochasticK,
                    stochasticD,
                    willrSeries,
                    cciSeries,
                    obvSeries
                };
                indicatorCache.set(tf, computed);
                return computed;
            })();

            const daily = await dailyPromise;
            const snapshot = buildSnapshotForReport({
                candles,
                daily,
                ma20: indicators.ma20,
                ma50: indicators.ma50,
                ma100: indicators.ma100,
                ma200: indicators.ma200,
                rsi: indicators.rsiSeries,
                macdObj: indicators.macdObj,
                bb: indicators.bb,
                kc: indicators.kc,
                atr: indicators.atrSeries,
                adx: indicators.adxSeries,
                volSeries: vol
            });
            snapshots[tf] = snapshot;

            if (enableCharts) {
                const chartPath = await renderChartPNG(asset.key, tf, candles, {
                    ma20: indicators.ma20,
                    ma50: indicators.ma50,
                    ma200: indicators.ma200,
                    bbUpper: indicators.bb.upper,
                    bbLower: indicators.bb.lower,
                });
                chartPaths.push(chartPath);
            }

            if (enableAlerts) {
                const alerts = await buildAlerts({
                    rsiSeries: indicators.rsiSeries,
                    macdObj: indicators.macdObj,
                    bbWidth: indicators.bbWidth,
                    ma20: indicators.ma20,
                    ma50: indicators.ma50,
                    ma200: indicators.ma200,
                    lastClose: snapshot.kpis.price,
                    var24h: snapshot.kpis.var24h,
                    closes: close,
                    highs: high,
                    lows: low,
                    volumes: vol,
                    atrSeries: indicators.atrSeries,
                    upperBB: indicators.bb.upper,
                    lowerBB: indicators.bb.lower,
                    upperKC: indicators.kc.upper,
                    lowerKC: indicators.kc.lower,
                    adxSeries: indicators.adxSeries,
                    vwapSeries: indicators.vwapSeries,
                    ema9: indicators.ema9Series,
                    ema21: indicators.ema21Series,
                    stochasticK: indicators.stochasticK,
                    stochasticD: indicators.stochasticD,
                    willrSeries: indicators.willrSeries,
                    cciSeries: indicators.cciSeries,
                    obvSeries: indicators.obvSeries,
                    equity: CFG.accountEquity,
                    riskPct: CFG.riskPerTrade
                });
                const consolidated = [];
                const dedupMap = new Map();
                for (const alert of alerts) {
                    const key = [alert.level, alert.category, alert.msg].join('|');
                    const entry = dedupMap.get(key);
                    if (entry) {
                        entry.count += 1;
                    } else {
                        const withCount = { ...alert, count: 1 };
                        dedupMap.set(key, withCount);
                        consolidated.push(withCount);
                    }
                }
                const hasSignals = consolidated.some(a =>
                    !a.msg.startsWith('💰 Preço') && !a.msg.startsWith('📊 Var24h'));
                if (hasSignals) {
                    const mention = "@here";
                    const alertMsg = [
                        `**⚠️ Alertas — ${asset.key} ${tf}** ${mention}`,
                        ...consolidated.map(alert => `• ${formatAlertMessage(alert, alert.count)}`)
                    ].join("\n");
                    const hash = buildHash(alertMsg);
                    const windowMs = CFG.alertDedupMinutes * 60 * 1000;
                    if (shouldSend({ asset: asset.key, tf, hash }, windowMs)) {
                        await sendDiscordAlert(alertMsg);
                    }
                }
            }
        } catch (e) {
            log.error({ fn: 'runOnceForAsset', err: e }, 'Processing error');
            await notifyOps(`Processing error for ${asset.key} ${tf}: ${e.message || e}`);
        }
    });

    await Promise.all(timeframeTasks);
    saveStore();
    let summary = null;
    if (snapshots["4h"]) {
        summary = buildSummary({ assetKey: asset.key, snapshots });
        if (enableAnalysis && shouldPostAnalysis) {
            const analysisResult = await postAnalysis(asset.key, "4h", summary);
            if (!analysisResult?.posted) {
                const log = withContext(logger, { asset: asset.key, timeframe: '4h' });
                log.warn({ fn: 'runOnceForAsset', reportPath: analysisResult?.path }, 'report upload failed');
            }
        }
    }
    if (enableCharts && shouldPostCharts && chartPaths.length > 0) {
        const chartsSent = await postCharts(chartPaths);
        if (!chartsSent) {
            const log = withContext(logger, { asset: asset.key });
            log.warn({ fn: 'runOnceForAsset' }, 'chart upload failed');
        }
    }
    return { snapshots, summary, chartPaths };
}

async function runAll() {
    const limit = pLimit(calcConcurrency());
    await Promise.all(
        ASSETS.map(asset => limit(() => runOnceForAsset(asset)))
    );
}

const DAILY_ALERT_SCOPE = 'daily';
const DAILY_ALERT_KEY = 'analysis';
const WEEKLY_ALERT_SCOPE = 'weekly';
const WEEKLY_ALERT_KEY = 'analysis';

async function runDailyAnalysis() {
    const log = withContext(logger, { asset: 'DAILY', timeframe: '1d' });
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
            const hash = buildHash(finalReport);
            if (getAlertHash(DAILY_ALERT_SCOPE, DAILY_ALERT_KEY) === hash) {
                log.info({ fn: 'runDailyAnalysis' }, 'Skipping daily analysis post (duplicate hash)');
                return;
            }
            const analysisResult = await postAnalysis("DAILY", "1d", finalReport);
            if (analysisResult?.posted) {
                updateAlertHash(DAILY_ALERT_SCOPE, DAILY_ALERT_KEY, hash);
                saveStore();
            } else {
                log.warn({ fn: 'runDailyAnalysis', reportPath: analysisResult?.path }, 'report upload failed');
            }
        }
    } catch (e) {
        log.error({ fn: 'runDailyAnalysis', err: e }, 'Error in daily analysis');
        await notifyOps(`Error in daily analysis: ${e.message || e}`);
    }
}

async function runWeeklyAnalysis() {
    const log = withContext(logger, { asset: 'WEEKLY', timeframe: '1w' });
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
        const perfSummary = reportWeeklyPerf();
        const perfEntries = Object.entries(perfSummary)
            .filter(([, { count }]) => count > 0)
            .map(([name, { avg, count }]) => {
                const ms = avg.toFixed(2);
                return `- ${name}: ${ms} ms (n=${count})`;
            });
        const sections = [lines.join("\n")];
        if (perfEntries.length) {
            sections.push(["**Weekly runtime averages (ms)**", ...perfEntries].join("\n"));
        }
        sections.push(report);
        const finalReport = sections.join("\n\n");
        if (CFG.enableReports) {
            const hash = buildHash(finalReport);
            if (getAlertHash(WEEKLY_ALERT_SCOPE, WEEKLY_ALERT_KEY) === hash) {
                log.info({ fn: 'runWeeklyAnalysis' }, 'Skipping weekly analysis post (duplicate hash)');
                return;
            }
            const analysisResult = await postAnalysis("WEEKLY", "1w", finalReport);
            if (analysisResult?.posted) {
                updateAlertHash(WEEKLY_ALERT_SCOPE, WEEKLY_ALERT_KEY, hash);
                saveStore();
            } else {
                log.warn({ fn: 'runWeeklyAnalysis', reportPath: analysisResult?.path }, 'report upload failed');
            }
        }
    } catch (e) {
        log.error({ fn: 'runWeeklyAnalysis', err: e }, 'Error in weekly analysis');
        await notifyOps(`Error in weekly analysis: ${e.message || e}`);
    }
}

const ONCE = process.argv.includes("--once");

const runningAssets = new Set();
function scheduleRun(asset) {
    if (runningAssets.has(asset.key)) return;
    runningAssets.add(asset.key);
    runOnceForAsset(asset).finally(() => runningAssets.delete(asset.key));
}

async function handleAnalysisSlashCommand({ asset, timeframe }) {
    const { summary } = await runOnceForAsset(asset, {
        enableCharts: false,
        postCharts: false,
        enableAlerts: false,
        enableAnalysis: true,
        postAnalysis: false
    });
    return summary;
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
    const scheduleLog = withContext(logger);
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const rawDailyReportHours = Array.isArray(CFG.dailyReportHours)
        ? CFG.dailyReportHours
        : Array.isArray(CFG.dailyReportHour)
            ? CFG.dailyReportHour
            : [CFG.dailyReportHour];
    const dailyReportHours = Array.from(new Set(
        rawDailyReportHours
            .map((hour) => Number.parseInt(hour, 10))
            .filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23)
    )).sort((a, b) => a - b);
    for (const hour of dailyReportHours) {
        cron.schedule(`0 ${hour} * * *`, runDailyAnalysis, { timezone: CFG.tz });
        scheduleLog.info({ fn: 'schedule', channel: 'analysis', hour }, `⏱️ Scheduled daily at ${hour}h (TZ=${CFG.tz})`);
    }
    cron.schedule('0 18 * * 0', runWeeklyAnalysis, { timezone: CFG.tz });
    scheduleLog.info({ fn: 'schedule' }, `⏱️ Scheduled weekly at 18h Sunday (TZ=${CFG.tz})`);
    cron.schedule('0 0 * * 0', () => {
        const log = withContext(logger, { fn: 'resetAlertHashesJob' });
        resetAlertHashes();
        saveStore();
        log.info('Reset stored daily/weekly alert hashes');
    }, { timezone: CFG.tz });
    scheduleLog.info({ fn: 'schedule' }, '♻️ Scheduled weekly alert hash reset');
    cron.schedule('0 0 * * *', () => pruneOlderThan(sevenDaysMs), { timezone: CFG.tz });
    scheduleLog.info({ fn: 'schedule' }, '🧹 Scheduled daily alert cache pruning (older than 7 days)');
    runAll();
    pruneOlderThan(sevenDaysMs);
    runDailyAnalysis();
    runWeeklyAnalysis();
} else {
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    runAll();
    pruneOlderThan(sevenDaysMs);
    runDailyAnalysis();
    runWeeklyAnalysis();
}
