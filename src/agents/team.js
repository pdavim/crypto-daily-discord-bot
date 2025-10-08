import { CFG } from "../config.js";
import { ASSETS } from "../assets.js";
import { fetchOHLCV } from "../data/binance.js";
import { getAssetNews } from "../news.js";
import { searchWeb } from "../websearch.js";
import {
    sma,
    rsi,
    macd,
    bollinger,
    bollWidth,
    atr14,
    parabolicSAR,
    semaforo,
    isBBSqueeze,
    sparkline,
    volumeDivergence,
    trendFromMAs,
    scoreHeuristic,
    vwap,
    ema,
    stochastic,
    williamsR,
    cci,
    obv,
} from "../indicators.js";
import { logger, withContext } from "../logger.js";
import { calcReturn, fallbackVerdict, getMacroContext } from "./common.js";
import { createAgentTeam } from "./store.js";
import { createTechnicalRole } from "./roles/technical.js";
import { createNewsRole } from "./roles/news.js";
import { createSentimentRole } from "./roles/sentiment.js";
import { createResearchRole } from "./roles/research.js";
import { createTraderRole } from "./roles/trader.js";
import { createRiskRole } from "./roles/risk.js";
import { createExecutionRole, executionOutputSchema, EXECUTION_TASK_ID } from "./roles/execution.js";

const DEFAULT_LOG_LEVEL = "info";

const normalizeNumber = (value) => (Number.isFinite(value) ? value : null);

const safeSlice = (value, limit) => {
    if (!Array.isArray(value)) {
        return [];
    }
    if (!Number.isInteger(limit) || limit <= 0) {
        return value.slice();
    }
    return value.slice(0, limit);
};

async function buildAssetSnapshot({ key, binance }) {
    const log = withContext(logger, { fn: "buildAssetSnapshot", asset: key });
    if (!binance) {
        return {
            key,
            status: "missing-symbol",
            message: "No Binance symbol configured.",
        };
    }

    try {
        const [hourly, daily] = await Promise.all([
            fetchOHLCV(binance, "1h"),
            fetchOHLCV(binance, "1d"),
        ]);

        if (!hourly.length || !daily.length) {
            return {
                key,
                status: "no-data",
                message: "No candle data.",
                meta: { binance },
            };
        }

        const closesH = hourly.map((candle) => candle.c);
        const highsH = hourly.map((candle) => candle.h);
        const lowsH = hourly.map((candle) => candle.l);
        const volumesH = hourly.map((candle) => candle.v);

        const ma20Series = sma(closesH, 20);
        const ma50Series = sma(closesH, 50);
        const ma200Series = sma(closesH, 200);
        const ma20 = normalizeNumber(ma20Series.at(-1));
        const ma50 = normalizeNumber(ma50Series.at(-1));
        const ma200 = normalizeNumber(ma200Series.at(-1));

        const rsiSeries = rsi(closesH, 14);
        const rsi14 = normalizeNumber(rsiSeries.at(-1));

        const macdResult = macd(closesH, 12, 26, 9);
        const macdLine = normalizeNumber(macdResult.macd.at(-1));
        const macdSignal = normalizeNumber(macdResult.signal.at(-1));
        const macdHistogram = normalizeNumber(macdResult.hist.at(-1));

        const bb = bollinger(closesH, 20, 2);
        const widthSeries = bollWidth(bb.upper, bb.lower, bb.mid);
        const bollingerWidth = normalizeNumber(widthSeries.at(-1));
        const bollingerSqueeze = Boolean(isBBSqueeze(widthSeries));

        const atrSeries = atr14(hourly);
        const atrValue = normalizeNumber(atrSeries.at(-1));

        const sarSeries = parabolicSAR(hourly, 0.02, 0.2);
        const sarValue = normalizeNumber(sarSeries.at(-1));

        const volumeSeries = volumeDivergence(closesH, volumesH, 14);
        const volumeValue = normalizeNumber(volumeSeries.at(-1));

        const vwapSeries = vwap(highsH, lowsH, closesH, volumesH);
        const vwapValue = normalizeNumber(vwapSeries.at(-1));

        const ema9Series = ema(closesH, 9);
        const ema21Series = ema(closesH, 21);
        const ema9Value = normalizeNumber(ema9Series.at(-1));
        const ema21Value = normalizeNumber(ema21Series.at(-1));

        const stochasticResult = stochastic(highsH, lowsH, closesH, 14, 3);
        const stochasticKValue = normalizeNumber(stochasticResult.k.at(-1));
        const stochasticDValue = normalizeNumber(stochasticResult.d.at(-1));

        const williamsSeries = williamsR(highsH, lowsH, closesH, 14);
        const williamsValue = normalizeNumber(williamsSeries.at(-1));

        const cciSeries = cci(highsH, lowsH, closesH, 20);
        const cciValue = normalizeNumber(cciSeries.at(-1));

        const obvSeries = obv(closesH, volumesH);
        const obvValue = normalizeNumber(obvSeries.at(-1));

        const trendValue = normalizeNumber(trendFromMAs(ma20Series, ma50Series, ma200Series));
        const heuristicScore = normalizeNumber(scoreHeuristic({
            rsi: rsi14,
            macdHist: macdHistogram,
            width: bollingerWidth,
            trend: trendValue,
        }));
        const semaf = semaforo(heuristicScore ?? 0);
        const fallback = fallbackVerdict({ ma20, ma50, rsi14 });
        const spark = sparkline(closesH);

        const lastDaily = daily.at(-1) ?? null;
        const dailyCloses = daily.map((candle) => candle.c);
        const returns = {
            day1: normalizeNumber(calcReturn(dailyCloses, 1)),
            day7: normalizeNumber(calcReturn(dailyCloses, 7)),
            day30: normalizeNumber(calcReturn(dailyCloses, 30)),
        };

        let newsSummary = "";
        let weightedSentiment = null;
        let newsItems = [];
        try {
            const newsData = await getAssetNews({ symbol: key });
            newsSummary = newsData.summary ?? "";
            if (Number.isFinite(newsData.weightedSentiment)) {
                weightedSentiment = newsData.weightedSentiment;
            }
            newsItems = Array.isArray(newsData.items) ? newsData.items : [];
        } catch (error) {
            log.warn({ fn: "buildAssetSnapshot", err: error }, 'Failed to fetch asset news');
        }

        let webSnippets = [];
        try {
            webSnippets = await searchWeb(key);
        } catch (error) {
            log.warn({ fn: "buildAssetSnapshot", err: error }, 'Failed to fetch web research');
        }

        return {
            key,
            status: "ready",
            meta: { binance },
            snapshot: {
                market: {
                    lastDaily,
                    returns,
                },
                technical: {
                    ma20,
                    ma50,
                    ma200,
                    rsi14,
                    macdLine,
                    macdSignal,
                    macdHistogram,
                    bollingerUpper: normalizeNumber(bb.upper.at(-1)),
                    bollingerLower: normalizeNumber(bb.lower.at(-1)),
                    bollingerWidth,
                    bollingerSqueeze,
                    atr: atrValue,
                    sar: sarValue,
                    volume: volumeValue,
                    trend: trendValue,
                    vwap: vwapValue,
                    ema9: ema9Value,
                    ema21: ema21Value,
                    stochasticK: stochasticKValue,
                    stochasticD: stochasticDValue,
                    williamsR: williamsValue,
                    cci: cciValue,
                    obv: obvValue,
                    sparkline: spark,
                    heuristicScore,
                    semaforo: semaf,
                    fallbackVerdict: fallback,
                },
                heuristics: {
                    score: heuristicScore,
                    semaforo: semaf,
                    fallbackVerdict: fallback,
                },
                sentiment: {
                    weighted: weightedSentiment,
                },
                news: {
                    summary: newsSummary,
                    snippets: safeSlice(newsItems, 5).map((item) => `${item.source ?? "Unknown"}: ${item.title ?? ""}`.trim()),
                },
                research: {
                    snippets: safeSlice(webSnippets, 5),
                },
            },
        };
    } catch (error) {
        log.error({ fn: "buildAssetSnapshot", err: error }, "Failed to prepare snapshot");
        return {
            key,
            status: "error",
            message: error.message,
            meta: { binance },
        };
    }
}

async function buildMarketSnapshot() {
    const log = withContext(logger, { fn: "buildMarketSnapshot" });
    log.info({ fn: "buildMarketSnapshot" }, 'Collecting market snapshot for Kaiban workflow');
    const macro = await getMacroContext();
    const assets = [];
    for (const asset of ASSETS) {
        const snapshot = await buildAssetSnapshot(asset);
        assets.push(snapshot);
    }
    return {
        generatedAt: new Date().toISOString(),
        macro,
        assets,
    };
}

function buildRoles(snapshot) {
    const maxIterations = CFG.kaiban?.maxIterations ?? 3;
    const models = CFG.kaiban?.models ?? {};
    const apiKey = CFG.openrouterApiKey;

    const technical = createTechnicalRole({
        snapshot,
        model: models.technical ?? CFG.openrouterModel,
        apiKey,
        maxIterations,
    });
    const news = createNewsRole({
        snapshot,
        model: models.news ?? CFG.openrouterModel,
        apiKey,
        maxIterations,
    });
    const sentiment = createSentimentRole({
        snapshot,
        model: models.sentiment ?? CFG.openrouterModel,
        apiKey,
        maxIterations,
    });
    const research = createResearchRole({
        snapshot,
        model: models.research ?? CFG.openrouterModel,
        apiKey,
        maxIterations,
    });
    const trader = createTraderRole({
        model: models.trader ?? CFG.openrouterModel,
        apiKey,
        maxIterations,
    });
    const risk = createRiskRole({
        model: models.risk ?? CFG.openrouterModel,
        apiKey,
        maxIterations,
    });
    const execution = createExecutionRole({
        snapshot,
        model: models.execution ?? CFG.openrouterModel,
        apiKey,
        maxIterations,
    });

    return {
        agents: [
            technical.agent,
            news.agent,
            sentiment.agent,
            research.agent,
            trader.agent,
            risk.agent,
            execution.agent,
        ],
        tasks: [
            technical.task,
            news.task,
            sentiment.task,
            research.task,
            trader.task,
            risk.task,
            execution.task,
        ],
    };
}

function snapshotTaskResults(store) {
    try {
        const state = store.getState();
        if (state && typeof state.getTaskResults === "function") {
            const results = state.getTaskResults();
            if (results && typeof results === "object") {
                return JSON.parse(JSON.stringify(results));
            }
        }
    } catch (error) {
        const log = withContext(logger, { fn: "snapshotTaskResults" });
        log.warn({ fn: "snapshotTaskResults", err: error }, 'Failed to snapshot Kaiban task results');
    }
    return {};
}

export async function runKaibanWorkflow() {
    const log = withContext(logger, { fn: "runKaibanWorkflow" });
    if (!CFG.openrouterApiKey) {
        throw new Error("OpenRouter API key missing for Kaiban workflow");
    }
    log.info({ fn: "runKaibanWorkflow" }, 'Starting Kaiban agent workflow');
    const snapshot = await buildMarketSnapshot();
    const { agents, tasks } = buildRoles(snapshot);
    const { team, store } = createAgentTeam({
        name: "Crypto Intelligence Desk",
        agents,
        tasks,
        inputs: { snapshot },
        logLevel: CFG.kaiban?.logLevel ?? DEFAULT_LOG_LEVEL,
    });

    const workflow = await team.start();
    const taskResults = snapshotTaskResults(store);

    try {
        const state = store.getState();
        if (state && typeof state.setInputs === "function") {
            state.setInputs({ snapshot, taskResults });
        }
    } catch (error) {
        log.warn({ fn: "runKaibanWorkflow", err: error }, 'Unable to persist task results into Kaiban store');
    }

    let executionResultRaw = workflow.result;
    if (!executionResultRaw) {
        executionResultRaw = taskResults[EXECUTION_TASK_ID] ?? null;
    }

    let executionResult;
    try {
        executionResult = executionOutputSchema.parse(
            executionResultRaw ?? {
                generatedAt: snapshot.generatedAt,
                report: "",
                decisions: [],
            },
        );
    } catch (error) {
        log.error({ fn: "runKaibanWorkflow", err: error }, "Execution output failed schema validation");
        throw error;
    }

    return {
        ...executionResult,
        workflowStatus: workflow.status,
        workflowStats: workflow.stats,
        taskResults,
        snapshot,
    };
}
