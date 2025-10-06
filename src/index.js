import cron from "node-cron";
import http from "http";
import { CFG } from "./config.js";
import { ASSETS, TIMEFRAMES, BINANCE_INTERVALS } from "./assets.js";
import { fetchOHLCV, fetchDailyCloses } from "./data/binance.js";
import { streamKlines } from "./data/binanceStream.js";
import { sma, rsi, macd, bollinger, atr14, bollWidth, vwap, ema, adx, stochastic, williamsR, cci, obv, keltnerChannel } from "./indicators.js";
import { buildSnapshotForReport, buildSummary } from "./reporter.js";
import { postAnalysis, sendDiscordAlert, postMonthlyReport, sendDiscordAlertWithAttachments } from "./discord.js";
import { postCharts, initBot } from "./discordBot.js";
import { renderChartPNG, renderForecastChart } from "./chart.js";
import { buildAlerts } from "./alerts.js";
import { runAgent } from "./ai.js";
import {
    getSignature,
    updateSignature,
    saveStore,
    getAlertHash,
    updateAlertHash,
    resetAlertHashes,
    updateForecastSnapshot,
} from "./store.js";
import { fetchEconomicEvents } from "./data/economic.js";
import { logger, withContext } from "./logger.js";
import pLimit, { calcConcurrency } from "./limit.js";
import { buildHash, shouldSend, pruneOlderThan } from "./alertCache.js";
import { register, forecastConfidenceHistogram, forecastDirectionCounter, forecastErrorHistogram } from "./metrics.js";
import { notifyOps } from "./monitor.js";
import { reportWeeklyPerf } from "./perf.js";
import { saveWeeklySnapshot, loadWeeklySnapshots } from "./weeklySnapshots.js";
import { renderMonthlyPerformanceChart } from "./monthlyReport.js";
import { runAssetsSafely } from "./runner.js";
import { enqueueAlertPayload, flushAlertQueue } from "./alerts/dispatcher.js";
import { recordAlert, recordDelivery } from "./controllers/sheetsReporter.js";
import { buildAssetAlertMessage, buildAssetGuidanceMessage } from "./alerts/messageBuilder.js";
import { deriveDecisionDetails } from "./alerts/decision.js";
import { collectVariationMetrics } from "./alerts/variationMetrics.js";
import { evaluateMarketPosture, deriveStrategyFromPosture } from "./trading/posture.js";
import { automateTrading } from "./trading/automation.js";
import { forecastNextClose, persistForecastEntry } from "./forecasting.js";
import { runPortfolioGrowthSimulation } from "./portfolio/growth.js";

const ONCE = process.argv.includes("--once");

const DEFAULT_ANALYSIS_FREQUENCY_KEY = "hourly";
const ANALYSIS_FREQUENCY_SCHEDULES = new Map([
    ["5m", { cron: "*/5 * * * *", label: "every 5 minutes" }],
    ["15m", { cron: "*/15 * * * *", label: "every 15 minutes" }],
    ["30m", { cron: "*/30 * * * *", label: "every 30 minutes" }],
    ["hourly", { cron: "0 * * * *", label: "hourly at minute 0" }],
    ["2h", { cron: "0 */2 * * *", label: "every 2 hours" }],
    ["4h", { cron: "0 */4 * * *", label: "every 4 hours" }],
    ["6h", { cron: "0 */6 * * *", label: "every 6 hours" }],
    ["12h", { cron: "0 */12 * * *", label: "every 12 hours" }],
    ["daily", { cron: "0 0 * * *", label: "daily at midnight" }],
]);
const ANALYSIS_FREQUENCY_ALIASES = new Map([
    ["5min", "5m"],
    ["300s", "5m"],
    ["1h", "hourly"],
    ["60m", "hourly"],
    ["120m", "2h"],
    ["240m", "4h"],
    ["360m", "6h"],
    ["720m", "12h"],
    ["24h", "daily"],
    ["1d", "daily"],
]);

/**
 * Resolves the configured analysis frequency into a cron expression.
 * @param {string} value - Configured frequency value.
 * @returns {{ cron: string, label: string, key: string, alias: string|null, isFallback: boolean, input: string }}
 */
function resolveAnalysisSchedule(value) {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (ANALYSIS_FREQUENCY_SCHEDULES.has(normalized)) {
        const schedule = ANALYSIS_FREQUENCY_SCHEDULES.get(normalized);
        return { ...schedule, key: normalized, alias: null, isFallback: false, input: normalized };
    }
    const aliasTarget = ANALYSIS_FREQUENCY_ALIASES.get(normalized);
    if (aliasTarget && ANALYSIS_FREQUENCY_SCHEDULES.has(aliasTarget)) {
        const schedule = ANALYSIS_FREQUENCY_SCHEDULES.get(aliasTarget);
        return { ...schedule, key: aliasTarget, alias: normalized, isFallback: false, input: normalized };
    }
    const fallback = ANALYSIS_FREQUENCY_SCHEDULES.get(DEFAULT_ANALYSIS_FREQUENCY_KEY);
    return { ...fallback, key: DEFAULT_ANALYSIS_FREQUENCY_KEY, alias: null, isFallback: true, input: normalized };
}

process.on('unhandledRejection', (err) => {
    const log = withContext(logger, { fn: 'unhandledRejection' });
    log.error({ err }, 'Unhandled promise rejection');
});

initBot({ onAnalysis: handleAnalysisSlashCommand });

if (!ONCE) {
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
}

/**
 * Converts an internal timeframe label into a Binance interval string.
 * @param {string} tf - Timeframe label (e.g. "4h").
 * @returns {string} Equivalent Binance interval.
 */
function tfToInterval(tf) { return BINANCE_INTERVALS[tf] || tf; }

/**
 * Aggregates 15 minute candles into 45 minute candles.
 * @param {Array<{t: Date, o: number, h: number, l: number, c: number, v: number}>} candles15m - Source candles.
 * @returns {Array<object>} Aggregated candle series.
 */
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


/**
 * Performs the full analysis, alerting and chart generation pipeline for an asset.
 * @param {Object} asset - Asset metadata.
 * @param {string} asset.key - Asset identifier.
 * @param {string} asset.binance - Binance symbol.
 * @param {Object} [options={}] - Configuration flags controlling side effects.
 * @param {boolean} [options.enableCharts]
 * @param {boolean} [options.enableAlerts]
 * @param {boolean} [options.enableAnalysis]
 * @param {boolean} [options.postAnalysis]
 * @param {boolean} [options.postCharts]
 * @returns {Promise} Outputs generated by the run including snapshots, summary and chart paths.
 */
async function runOnceForAsset(asset, options = {}) {
    const {
        enableCharts = CFG.enableCharts,
        enableAlerts = CFG.enableAlerts,
        enableAnalysis = CFG.enableAnalysis,
        postAnalysis: shouldPostAnalysis = enableAnalysis,
        postCharts: shouldPostCharts = enableCharts,
        forceFreshRun = false
    } = options;
    const assetLog = withContext(logger, { asset: asset.key });
    const dailyPromise = fetchDailyCloses(asset.binance, 32).catch(err => {
        assetLog.warn({ fn: 'runOnceForAsset', err }, 'Daily closes unavailable; continuing without historical context');
        return [];
    });
    const snapshots = {};
    const chartPaths = [];
    const forecastChartPaths = [];
    const timeframeMeta = new Map();

    const intervalPromises = new Map();
    for (const tf of TIMEFRAMES) {
        const interval = tfToInterval(tf);
        if (!intervalPromises.has(interval)) {
            intervalPromises.set(interval, fetchOHLCV(asset.binance, interval));
        }
    }
    const intervalKeys = [...intervalPromises.keys()];
    let candlesByInterval;
    try {
        const intervalResults = await Promise.all(intervalKeys.map(k => intervalPromises.get(k)));
        candlesByInterval = new Map(intervalKeys.map((k, i) => [k, intervalResults[i]]));
    } catch (err) {
        assetLog.error({ fn: 'runOnceForAsset', err }, 'Failed to load price data for asset');
        await notifyOps(`Failed to load price data for ${asset.key}: ${err.message || err}`);
        return { snapshots: {}, summary: null, chartPaths: [] };
    }

    let cached45mCandles;
    const indicatorCache = new Map();

    const deferredSignatureWrites = [];

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
            if (lastCandleTime != null) {
                const signatureMatches = getSignature(key) === lastCandleTime;
                if (!forceFreshRun && signatureMatches) {
                    return;
                }
                const writeSignature = () => updateSignature(key, lastCandleTime);
                if (forceFreshRun) {
                    deferredSignatureWrites.push(writeSignature);
                } else {
                    writeSignature();
                }
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
            const variationMetrics = collectVariationMetrics({ snapshots });
            const timeframeVariation = snapshot?.kpis?.var ?? null;
            const guidance = snapshot?.kpis?.reco ?? null;

            const posture = evaluateMarketPosture({
                closes: close,
                maFastSeries: indicators.ma50,
                maSlowSeries: indicators.ma200,
                rsiSeries: indicators.rsiSeries,
                adxSeries: indicators.adxSeries,
                config: CFG.marketPosture,
            });
            const strategyPlan = deriveStrategyFromPosture(posture, CFG.trading?.strategy);
            log.info({
                fn: 'runOnceForAsset',
                posture: posture.posture,
                confidence: posture.confidence,
                strategy: strategyPlan.action,
            }, 'Evaluated market posture');

            const decision = deriveDecisionDetails({
                strategy: strategyPlan,
                posture,
            });

            const meta = {
                consolidated: [],
                actionable: [],
                guidance,
                variation: timeframeVariation,
                posture,
                strategy: strategyPlan,
                decision,
            };
            timeframeMeta.set(tf, meta);

            try {
                await automateTrading({
                    assetKey: asset.key,
                    symbol: asset.binance,
                    timeframe: tf,
                    decision,
                    posture,
                    strategy: strategyPlan,
                    snapshot,
                });
            } catch (err) {
                log.error({ fn: 'runOnceForAsset', err }, 'Automated trading failed');
            }

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

            if (CFG.forecasting?.enabled) {
                const forecastLog = withContext(logger, { asset: asset.key, timeframe: tf });
                try {
                    const candleTimes = candles.map(c => c.t);
                    const forecastResult = forecastNextClose({
                        closes: close,
                        timestamps: candleTimes,
                        lookback: CFG.forecasting.lookback,
                        minHistory: CFG.forecasting.minHistory,
                    });
                    if (forecastResult) {
                        const runAtIso = new Date().toISOString();
                        const predictedAtIso = Number.isFinite(forecastResult.nextTime)
                            ? new Date(forecastResult.nextTime).toISOString()
                            : null;
                        const lastCloseIso = Number.isFinite(forecastResult.lastTime)
                            ? new Date(forecastResult.lastTime).toISOString()
                            : null;
                        const forecastEntry = {
                            runAt: runAtIso,
                            predictedAt: predictedAtIso,
                            lastCloseAt: lastCloseIso,
                            lastClose: forecastResult.lastClose,
                            forecastClose: forecastResult.forecast,
                            delta: forecastResult.delta,
                            confidence: forecastResult.confidence,
                            method: forecastResult.method,
                            samples: forecastResult.samples,
                            mae: forecastResult.mae,
                            rmse: forecastResult.rmse,
                            slope: forecastResult.slope,
                            intercept: forecastResult.intercept,
                            horizonMs: forecastResult.horizonMs,
                        };
                        const persistence = persistForecastEntry({
                            assetKey: asset.key,
                            timeframe: tf,
                            entry: forecastEntry,
                            directory: CFG.forecasting.outputDir,
                            historyLimit: CFG.forecasting.historyLimit,
                        });

                        meta.forecast = {
                            forecastClose: forecastResult.forecast,
                            lastClose: forecastResult.lastClose,
                            lastCloseAt: lastCloseIso,
                            delta: forecastResult.delta,
                            confidence: forecastResult.confidence,
                            predictedAt: predictedAtIso,
                            runAt: runAtIso,
                            method: forecastResult.method,
                            horizonMs: forecastResult.horizonMs,
                            samples: forecastResult.samples,
                            evaluation: persistence?.evaluation ?? null,
                            historyPath: persistence?.filePath ?? null,
                            timeZone: CFG.tz,
                        };
                        updateForecastSnapshot(asset.key, tf, meta.forecast);

                        if (Number.isFinite(forecastResult.confidence)) {
                            forecastConfidenceHistogram.observe(forecastResult.confidence);
                        }

                        if (CFG.forecasting.charts?.enabled) {
                            const forecastChartPath = await renderForecastChart({
                                assetKey: asset.key,
                                timeframe: tf,
                                closes: close,
                                timestamps: candleTimes,
                                forecastValue: forecastResult.forecast,
                                forecastTime: forecastResult.nextTime,
                                confidence: forecastResult.confidence,
                                options: {
                                    directory: CFG.forecasting.charts.directory,
                                    historyPoints: CFG.forecasting.charts.historyPoints,
                                },
                            });
                            if (forecastChartPath) {
                                forecastChartPaths.push(forecastChartPath);
                            }
                        }

                        const evaluation = persistence?.evaluation ?? null;
                        if (evaluation && Number.isFinite(evaluation.pctError)) {
                            forecastErrorHistogram.observe(evaluation.pctError);
                        }
                        if (evaluation && typeof evaluation.directionHit === 'boolean') {
                            forecastDirectionCounter.labels(evaluation.directionHit ? 'hit' : 'miss').inc();
                        }

                        const logPayload = {
                            fn: 'runOnceForAsset',
                            forecast: forecastResult.forecast,
                            confidence: forecastResult.confidence,
                            delta: forecastResult.delta,
                            mae: forecastResult.mae,
                            rmse: forecastResult.rmse,
                            historyPath: persistence?.filePath ?? null,
                        };

                        if (evaluation) {
                            logPayload.accuracy = {
                                absError: evaluation.absError,
                                pctError: evaluation.pctError,
                                directionHit: evaluation.directionHit,
                            };
                            logPayload.actual = evaluation.actual;
                            logPayload.predictedAt = evaluation.predictedAt;
                            logPayload.actualAt = evaluation.actualAt;
                            forecastLog.info(logPayload, 'Generated forecast');
                        } else {
                            forecastLog.debug(logPayload, 'Generated forecast');
                        }

                    }
                } catch (err) {
                    forecastLog.error({ fn: 'runOnceForAsset', err }, 'Forecast generation failed');
                }
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
                    timeframe: tf,
                    timeframeVariation,
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
                    riskPct: CFG.riskPerTrade,
                    variationByTimeframe: variationMetrics,
                    timeframeOrder: TIMEFRAMES
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
                const actionable = consolidated.filter(a =>
                    !a.msg.startsWith('💰 Preço') && !a.msg.startsWith('📊 Var'));
                timeframeMeta.set(tf, {
                    ...meta,
                    consolidated,
                    actionable,
                });
            }
        } catch (e) {
            log.error({ fn: 'runOnceForAsset', err: e }, 'Processing error');
            await notifyOps(`Processing error for ${asset.key} ${tf}: ${e.message || e}`);
        }
    });

    try {
        await Promise.all(timeframeTasks);
    } finally {
        if (forceFreshRun) {
            for (const writeSignature of deferredSignatureWrites) {
                writeSignature();
            }
        }
    }

    const variationByTimeframe = collectVariationMetrics({ snapshots });

    if (enableAlerts) {

        const timeframeSummaries = TIMEFRAMES.map(tf => {
            const meta = timeframeMeta.get(tf);
            if (!meta || meta.actionable.length === 0) {
                return null;
            }
            return {
                timeframe: tf,
                guidance: meta.guidance,
                decision: meta.decision,
                alerts: meta.consolidated,
                forecast: meta.forecast
            };
        }).filter(Boolean);

        if (timeframeSummaries.length > 0) {
            const alertMsg = buildAssetAlertMessage({
                assetKey: asset.key,
                mention: "@here",
                timeframeSummaries,
                variationByTimeframe,
                timeframeOrder: TIMEFRAMES
            });
            if (alertMsg) {
                const hash = buildHash(alertMsg);
                const windowMs = CFG.alertDedupMinutes * 60 * 1000;
                const scope = "aggregate";
                if (shouldSend({ asset: asset.key, tf: scope, hash }, windowMs)) {
                    enqueueAlertPayload({
                        asset: asset.key,
                        timeframe: scope,
                        message: alertMsg,
                        messageType: "aggregate_alert",
                        metadata: {
                            hash,
                            timeframeSummaries,
                            variationByTimeframe,
                        },
                    });
                }
            }
        }
    }

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

    const guidanceSummaries = TIMEFRAMES.map(tf => {
        const meta = timeframeMeta.get(tf);
        if (!meta) {
            return null;
        }
        return {
            timeframe: tf,
            guidance: meta.guidance,
            decision: meta.decision,
            forecast: meta.forecast,
            variation: meta.variation,
        };
    }).filter(Boolean);

    if (guidanceSummaries.length > 0) {
        const guidanceMessage = buildAssetGuidanceMessage({
            assetKey: asset.key,
            timeframeSummaries: guidanceSummaries,
            variationByTimeframe,
            timeframeOrder: TIMEFRAMES,
        });
        if (guidanceMessage) {
            const webhookUrl = CFG.webhookGeneral ?? CFG.webhook ?? null;
            if (!webhookUrl) {
                const log = withContext(logger, { asset: asset.key });
                log.warn({ fn: 'runOnceForAsset', scope: 'guidance' }, 'Skipping guidance message due to missing webhook');
            } else {
                const hash = buildHash(guidanceMessage);
                const windowMs = CFG.alertDedupMinutes * 60 * 1000;
                const scope = "guidance";
                if (shouldSend({ asset: asset.key, tf: scope, hash }, windowMs)) {
                    enqueueAlertPayload({
                        asset: asset.key,
                        timeframe: scope,
                        message: guidanceMessage,
                        messageType: "guidance_alert",
                        metadata: {
                            hash,
                            timeframeSummaries: guidanceSummaries,
                            variationByTimeframe,
                        },
                        options: { webhookUrl },
                    });
                }
            }
        }
    }
    if (enableCharts && shouldPostCharts) {
        const uploads = [...chartPaths];
        if (CFG.forecasting?.charts?.appendToUploads) {
            uploads.push(...forecastChartPaths);
        }
        if (uploads.length > 0) {
            const chartsSent = await postCharts(uploads);
            if (!chartsSent) {
                const log = withContext(logger, { asset: asset.key });
                log.warn({ fn: 'runOnceForAsset' }, 'chart upload failed');
            }
        }
    }
    return { snapshots, summary, chartPaths, forecastCharts: forecastChartPaths };
}

/**
 * Executes the processing pipeline for all configured assets respecting concurrency limits.
 * @returns {Promise}
 */
async function runAll() {
    const jobLog = withContext(logger, { fn: 'runAll' });
    const startedAt = Date.now();
    let status = 'success';
    jobLog.info('Starting runAll job');
    try {
        await runAssetsSafely({
            assets: ASSETS,
            limitFactory: () => pLimit(calcConcurrency()),
            runAsset: runOnceForAsset,
            logger,
        });
        await flushAlertQueue({
            sender: async payload => {
                const {
                    asset,
                    timeframe,
                    message,
                    messageType,
                    metadata,
                    attachments,
                    options,
                } = payload;

                const timestamp = new Date();
                const deliveryOptions = options ?? {};
                const delivered = await sendDiscordAlert(message, deliveryOptions);

                if (!delivered) {
                    return;
                }

                const baseRecord = {
                    asset,
                    timeframe,
                    content: message,
                    attachments,
                    metadata,
                    webhookKey: deliveryOptions.webhookKey,
                    webhookUrl: deliveryOptions.webhookUrl,
                    channelId: deliveryOptions.channelId,
                    timestamp,
                };

                if (messageType === "aggregate_alert" || messageType === "guidance_alert") {
                    recordAlert({
                        ...baseRecord,
                        scope: timeframe,
                    });
                } else if (messageType) {
                    recordDelivery({
                        ...baseRecord,
                        messageType,
                    });
                }
            },
            timeframeOrder: TIMEFRAMES
        });
        try {
            const growthSummary = await runPortfolioGrowthSimulation();
            if (growthSummary?.uploads?.length) {
                const uploaded = await postCharts(growthSummary.uploads);
                if (!uploaded) {
                    jobLog.warn({ uploads: growthSummary.uploads }, 'Failed to post portfolio growth chart');
                }
            }
            if (CFG.portfolioGrowth?.discord?.enabled && growthSummary?.discord?.message) {
                const webhook = CFG.portfolioGrowth.discord.webhookUrl?.trim();
                const channelId = CFG.portfolioGrowth.discord.channelId?.trim();
                const attachments = Array.isArray(growthSummary.discord.attachments)
                    ? growthSummary.discord.attachments
                    : [];
                const hasAttachments = attachments.length > 0;
                const delivered = hasAttachments
                    ? await sendDiscordAlertWithAttachments({
                        content: growthSummary.discord.message,
                        attachments,
                        webhookUrl: webhook,
                        channelId,
                    })
                    : await sendDiscordAlert(growthSummary.discord.message, {
                        webhookUrl: webhook,
                        channelId,
                    });
                if (!delivered) {
                    jobLog.warn('Failed to dispatch portfolio growth summary');
                }
            }
        } catch (error) {
            jobLog.warn({ err: error }, 'Portfolio growth simulation failed');
        }
    } catch (error) {
        status = 'failed';
        jobLog.error({ err: error }, 'runAll job failed');
        throw error;
    } finally {
        const durationMs = Date.now() - startedAt;
        jobLog.info({ durationMs, status }, 'Finished runAll job');
    }
}

const DAILY_ALERT_SCOPE = 'daily';
const DAILY_ALERT_KEY = 'analysis';

/**
 * Generates and posts the macro daily analysis report when new data is available.
 * @returns {Promise}
 */
async function runDailyAnalysis() {
    const log = withContext(logger, { fn: 'runDailyAnalysis', asset: 'DAILY', timeframe: '1d' });
    const startedAt = Date.now();
    let status = 'success';
    log.info('Starting daily analysis job');
    try {
        const dailyCandles = await fetchDailyCloses(ASSETS[0].binance, 2);
        const lastTime = dailyCandles.at(-1)?.t?.getTime?.();
        const key = "DAILY:1d";
        if (lastTime != null && getSignature(key) === lastTime) {
            log.debug({ key }, 'Daily analysis already processed for latest candle');
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
                log.info({ reason: 'duplicateHash' }, 'Skipping daily analysis post');
                return;
            }
            const analysisResult = await postAnalysis("DAILY", "1d", finalReport);
            if (analysisResult?.posted) {
                updateAlertHash(DAILY_ALERT_SCOPE, DAILY_ALERT_KEY, hash);
                saveStore();
            } else {
                log.warn({ reportPath: analysisResult?.path }, 'Report upload failed');
            }
        }
    } catch (e) {
        status = 'failed';
        log.error({ err: e }, 'Error in daily analysis');
        await notifyOps(`Error in daily analysis: ${e.message || e}`);
    } finally {
        const durationMs = Date.now() - startedAt;
        log.info({ durationMs, status }, 'Finished daily analysis job');
    }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Converts a date into a YYYY-MM month key within the provided timezone.
 * @param {Date} date - Date to convert.
 * @param {string} timeZone - IANA timezone identifier.
 * @returns {string} Month key string.
 */
function toMonthKey(date, timeZone) {
    try {
        const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' });
        const parts = formatter.formatToParts(date);
        const year = parts.find(part => part.type === 'year')?.value;
        const month = parts.find(part => part.type === 'month')?.value;
        if (year && month) {
            return `${year}-${month}`;
        }
    } catch (_) {
        // Fall back to UTC computation below.
    }
    const fallbackYear = date.getUTCFullYear();
    const fallbackMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `${fallbackYear}-${fallbackMonth}`;
}

/**
 * Parses an ISO string and converts it into a month key in the specified timezone.
 * @param {string} isoString - ISO date string.
 * @param {string} timeZone - IANA timezone identifier.
 * @returns {string|null} Month key or null when parsing fails.
 */
function monthKeyFromIso(isoString, timeZone) {
    if (!isoString) return null;
    const parsed = new Date(isoString);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }
    return toMonthKey(parsed, timeZone);
}

/**
 * Computes the month key for the month prior to the provided date.
 * @param {Date} referenceDate - Reference date.
 * @param {string} timeZone - IANA timezone identifier.
 * @returns {string} Month key string.
 */
function previousMonthKey(referenceDate, timeZone) {
    const previousDay = new Date(referenceDate.getTime() - DAY_MS);
    return toMonthKey(previousDay, timeZone);
}

/**
 * Aggregates weekly performance data for all assets and persists a snapshot.
 * @returns {Promise}
 */
async function generateWeeklySnapshot() {
    const log = withContext(logger, { fn: 'generateWeeklySnapshot' });
    const startedAt = Date.now();
    let status = 'success';
    log.info('Starting weekly snapshot job');
    try {
        const dailyCandles = await fetchDailyCloses(ASSETS[0].binance, 8);
        const lastTime = dailyCandles.at(-1)?.t?.getTime?.();
        const signatureKey = 'WEEKLY:SNAPSHOT';
        const weekMs = 7 * DAY_MS;
        const weekSignature = lastTime != null ? Math.floor(lastTime / weekMs) : null;
        if (weekSignature != null && getSignature(signatureKey) === weekSignature) {
            log.debug({ weekSignature }, 'Weekly snapshot already stored for current window.');
            return;
        }

        const assets = {};
        for (const asset of ASSETS) {
            const assetLog = withContext(logger, { fn: 'generateWeeklySnapshot', asset: asset.key });
            try {
                const candles = await fetchDailyCloses(asset.binance, 8);
                const last = candles.at(-1);
                const prev = candles.at(-8);
                const variation = (last?.c != null && prev?.c != null)
                    ? ((last.c / prev.c - 1) * 100)
                    : null;
                assets[asset.key] = {
                    close: last?.c ?? null,
                    variationPct: Number.isFinite(variation) ? Number.parseFloat(variation.toFixed(2)) : null,
                };
            } catch (err) {
                assetLog.warn({ err }, 'Failed to compute weekly variation.');
                assets[asset.key] = { error: true };
            }
        }

        const performance = reportWeeklyPerf();
        const entry = {
            generatedAt: new Date().toISOString(),
            weekSignature,
            timezone: CFG.tz,
            assets,
            performance,
        };
        await saveWeeklySnapshot(entry);
        if (weekSignature != null) {
            updateSignature(signatureKey, weekSignature);
            saveStore();
        }
        log.info({ weekSignature }, 'Saved weekly performance snapshot.');
    } catch (err) {
        status = 'failed';
        log.error({ err }, 'Error generating weekly snapshot');
        await notifyOps(`Error generating weekly snapshot: ${err.message || err}`);
    } finally {
        const durationMs = Date.now() - startedAt;
        log.info({ durationMs, status }, 'Finished weekly snapshot job');
    }
}

/**
 * Builds and dispatches the monthly performance report based on weekly snapshots.
 * @returns {Promise}
 */
async function compileMonthlyPerformanceReport() {
    const log = withContext(logger, { fn: 'compileMonthlyPerformanceReport' });
    const startedAt = Date.now();
    let status = 'success';
    log.info('Starting monthly performance report job');
    try {
        const now = new Date();
        const monthKey = previousMonthKey(now, CFG.tz);
        if (!monthKey) {
            log.warn('Unable to determine month key for monthly report.');
            return;
        }

        const signatureKey = `MONTHLY:${monthKey}`;
        if (getSignature(signatureKey) === monthKey) {
            log.debug({ monthKey }, 'Monthly report already processed.');
            return;
        }

        const snapshots = await loadWeeklySnapshots();
        const monthEntries = snapshots.filter(entry => monthKeyFromIso(entry?.generatedAt, CFG.tz) === monthKey);
        if (monthEntries.length === 0) {
            log.info({ monthKey }, 'No weekly snapshots available for monthly report.');
            return;
        }

        const assetStats = new Map();
        for (const entry of monthEntries) {
            for (const [assetKey, stats] of Object.entries(entry.assets ?? {})) {
                const rawValue = stats?.variationPct ?? stats?.performancePct ?? stats?.variation ?? null;
                const variation = typeof rawValue === 'string' ? Number.parseFloat(rawValue) : rawValue;
                if (!Number.isFinite(variation)) {
                    continue;
                }
                if (!assetStats.has(assetKey)) {
                    assetStats.set(assetKey, { total: 0, count: 0, min: variation, max: variation });
                }
                const agg = assetStats.get(assetKey);
                agg.total += variation;
                agg.count += 1;
                agg.min = Math.min(agg.min, variation);
                agg.max = Math.max(agg.max, variation);
            }
        }

        const ordered = Array.from(assetStats.entries())
            .filter(([, value]) => value.count > 0)
            .map(([assetKey, value]) => {
                const average = value.total / value.count;
                return {
                    assetKey,
                    average,
                    count: value.count,
                    min: value.min,
                    max: value.max,
                };
            })
            .sort((a, b) => b.average - a.average);

        if (ordered.length === 0) {
            log.info({ monthKey }, 'No valid asset data found for monthly report.');
            updateSignature(signatureKey, monthKey);
            saveStore();
            return;
        }

        const labels = ordered.map(item => item.assetKey);
        const values = ordered.map(item => item.average);
        let chartPath;
        try {
            chartPath = await renderMonthlyPerformanceChart({ monthKey, labels, values });
        } catch (err) {
            log.error({ err, monthKey }, 'Failed to render monthly performance chart.');
        }

        const lines = [
            `📊 Relatório mensal ${monthKey}`,
            '',
            `Semanas consideradas: ${monthEntries.length}`,
        ];
        for (const item of ordered) {
            lines.push(`- ${item.assetKey}: média ${item.average.toFixed(2)}% (min ${item.min.toFixed(2)}%, máx ${item.max.toFixed(2)}%, amostras=${item.count})`);
        }
        const content = lines.join("\n");
        const posted = await postMonthlyReport({ content, filePath: chartPath });
        if (posted) {
            updateSignature(signatureKey, monthKey);
            saveStore();
            log.info({ monthKey }, 'Monthly performance report sent.');
        } else {
            log.warn({ monthKey }, 'Monthly performance report was not sent.');
        }
    } catch (err) {
        status = 'failed';
        log.error({ err }, 'Error compiling monthly performance report');
        await notifyOps(`Error compiling monthly performance report: ${err.message || err}`);
    } finally {
        const durationMs = Date.now() - startedAt;
        log.info({ durationMs, status }, 'Finished monthly performance report job');
    }
}

const runningAssets = new Set();
/**
 * Queues a background run for the given asset if one is not already in progress.
 * @param {{key: string}} asset - Asset metadata.
 * @returns {void}
 */
function scheduleRun(asset) {
    if (runningAssets.has(asset.key)) return;
    runningAssets.add(asset.key);
    runOnceForAsset(asset).finally(() => runningAssets.delete(asset.key));
}

/**
 * Generates an analysis summary when requested by the Discord slash command.
 * @param {Object} params - Command payload.
 * @param {Object} params.asset - Asset metadata.
 * @param {string} params.timeframe - Timeframe requested by the user.
 * @returns {Promise} Generated summary text.
 */
async function handleAnalysisSlashCommand({ asset, timeframe }) {
    const { summary } = await runOnceForAsset(asset, {
        enableCharts: false,
        postCharts: false,
        enableAlerts: false,
        enableAnalysis: true,
        postAnalysis: false,
        forceFreshRun: true
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
    const analysisSchedule = resolveAnalysisSchedule(CFG.analysisFrequency);
    if (analysisSchedule.alias) {
        scheduleLog.info({ fn: 'schedule', provided: analysisSchedule.alias, normalized: analysisSchedule.key }, `ℹ️ Normalized analysis frequency "${analysisSchedule.alias}" to "${analysisSchedule.key}".`);
    }
    if (analysisSchedule.isFallback) {
        const provided = CFG.analysisFrequency;
        scheduleLog.warn({ fn: 'schedule', provided }, `Unknown analysis frequency "${provided}"; falling back to hourly cadence.`);
    }
    cron.schedule(analysisSchedule.cron, async () => {
        const log = withContext(logger, { fn: 'analysisSchedule', frequency: analysisSchedule.key });
        const startedAt = Date.now();
        log.info({ cadence: analysisSchedule.label, cron: analysisSchedule.cron }, 'Starting scheduled runAll');
        try {
            await runAll();
            const durationMs = Date.now() - startedAt;
            log.info({ cadence: analysisSchedule.label, cron: analysisSchedule.cron, durationMs }, 'Completed scheduled runAll');
        } catch (err) {
            log.error({ cadence: analysisSchedule.label, cron: analysisSchedule.cron, err }, 'Scheduled runAll failed');
        }
    }, { timezone: CFG.tz });
    scheduleLog.info({ fn: 'schedule', channel: 'analysis', frequency: analysisSchedule.key }, `🕒 Scheduled analysis ${analysisSchedule.label} (cron=${analysisSchedule.cron}, TZ=${CFG.tz})`);
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
    cron.schedule('0 18 * * 0', generateWeeklySnapshot, { timezone: CFG.tz });
    scheduleLog.info({ fn: 'schedule' }, `⏱️ Scheduled weekly snapshot at 18h Sunday (TZ=${CFG.tz})`);
    cron.schedule('0 1 1 * *', compileMonthlyPerformanceReport, { timezone: CFG.tz });
    scheduleLog.info({ fn: 'schedule' }, `📈 Scheduled monthly performance report on day 1 at 01h (TZ=${CFG.tz})`);
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
    generateWeeklySnapshot();
    compileMonthlyPerformanceReport();
} else {
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    await runAll();
    pruneOlderThan(sevenDaysMs);
    await runDailyAnalysis();
    await generateWeeklySnapshot();
    await compileMonthlyPerformanceReport();
    if (process.env.NODE_ENV !== 'test') {
        process.exit(0);
    }
}
export { runOnceForAsset, handleAnalysisSlashCommand };
