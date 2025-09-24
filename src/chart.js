// src/chart.js
import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import fs from "node:fs";
import "chartjs-adapter-luxon";
import { logger, withContext } from "./logger.js";
import { performance } from 'node:perf_hooks';
import { recordPerf } from './perf.js';
import {
    CandlestickController,
    CandlestickElement,
    OhlcController,
    OhlcElement,
} from "chartjs-chart-financial/dist/chartjs-chart-financial.esm.js";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const chartAutoPath = require.resolve("chart.js/auto");
const chartModule = await import("chart.js/auto");
const coreModule = await import("chart.js");
chartModule._adapters._date = coreModule._adapters._date;
const Chart = Object.assign(chartModule.Chart, chartModule);
require.cache[chartAutoPath] = { exports: Chart };
Chart.register(
    CandlestickController,
    CandlestickElement,
    OhlcController,
    OhlcElement,
);

// Canvas with Chart.js
const canvas = new ChartJSNodeCanvas({
    width: 1280,
    height: 640,
    chartJs: Chart,
});

// utilitários
const toMs = (x) => (x instanceof Date ? x.getTime() : +x);
const safe = (y) => (y == null ? null : y);
const hasTimeAdapter = () => {
    const proto = Chart?._adapters?._date?.prototype;
    return !!(proto && typeof proto.parse === "function");
};

// renderização
/**
 * Renders a candlestick chart PNG for the provided asset and timeframe.
 * @param {string} assetKey - Asset identifier used in the filename.
 * @param {string} tf - Timeframe label.
 * @param {Array<{t:Date,o:number,h:number,l:number,c:number,v:number}>} candles - Candle data.
 * @param {object} [indicators={}] - Indicator series to draw.
 * @param {object} [overlays={}] - Additional chart overlays.
 * @returns {Promise} Absolute path to the generated PNG file.
 */
export async function renderChartPNG(assetKey, tf, candles, indicators = {}, overlays = {}) {
    const start = performance.now();
    if (!fs.existsSync("charts")) fs.mkdirSync("charts", { recursive: true });
    const timeAdapter = hasTimeAdapter();
    const candlestickAvailable = !!Chart.registry.controllers.get("candlestick");
    const log = withContext(logger, { asset: assetKey, timeframe: tf });
    log.info({ fn: 'renderChartPNG', candlestickAvailable }, "candlestick");
    log.info({ fn: 'renderChartPNG', timeAdapter }, "time adapter");
    const useTime = timeAdapter;
    const labels = !useTime
        ? candles.map(c => new Date(toMs(c.t)).toISOString().slice(0, 16))
        : undefined;

    const {
        ma20: showMa20 = true,
        ma50: showMa50 = true,
        ma200: showMa200 = true,
        bb: showBB = true,
        volume: showVolume = false,
        psar: showPsar = false,
    } = overlays;

    const datasets = [];
    if (useTime) {
        const ohlc = candles.map(c => ({
            x: toMs(c.t), o: c.o, h: c.h, l: c.l, c: c.c,
        }));
        datasets.push({
            type: "candlestick",
            label: `${assetKey} ${tf}`,
            data: ohlc,
            borderWidth: 1,
        });
    } else if (candlestickAvailable) {
        const ohlc = candles.map((c, i) => ({ x: i, o: c.o, h: c.h, l: c.l, c: c.c }));
        datasets.push({
            type: "candlestick",
            label: `${assetKey} ${tf}`,
            data: ohlc,
            borderWidth: 1,
            parsing: false,
        });
    } else {
        const lineData = candles.map((c, i) => ({ x: i, y: c.c }));
        datasets.push({
            type: "line",
            label: `${assetKey} ${tf}`,
            data: lineData,
            borderWidth: 1,
            pointRadius: 0,
            parsing: false,
        });
    }

    // linhas de indicadores (SMA, Bollinger, etc.)
    if (showMa20 && indicators?.ma20) {
        datasets.push({
            type: "line", label: "SMA20",
            data: candles.map((c, i) => useTime ? ({ x: toMs(c.t), y: safe(indicators.ma20[i]) }) : safe(indicators.ma20[i])),
            borderWidth: 1, pointRadius: 0,
        });
    }

    if (showMa50 && indicators?.ma50) {
        datasets.push({
            type: "line", label: "SMA50",
            data: candles.map((c, i) => useTime ? ({ x: toMs(c.t), y: safe(indicators.ma50[i]) }) : safe(indicators.ma50[i])),
            borderWidth: 1, pointRadius: 0
        });
    }
    if (showMa200 && indicators?.ma200) {
        datasets.push({
            type: "line", label: "SMA200",
            data: candles.map((c, i) => useTime ? ({ x: toMs(c.t), y: safe(indicators.ma200[i]) }) : safe(indicators.ma200[i])),
            borderWidth: 1, pointRadius: 0
        });
    }
    if (showBB && indicators?.bbUpper) {
        datasets.push({
            type: "line", label: "BB Upper",
            data: candles.map((c, i) => useTime ? ({ x: toMs(c.t), y: safe(indicators.bbUpper[i]) }) : safe(indicators.bbUpper[i])),
            borderWidth: 1, pointRadius: 0
        });
    }
    if (showBB && indicators?.bbLower) {
        datasets.push({
            type: "line", label: "BB Lower",
            data: candles.map((c, i) => useTime ? ({ x: toMs(c.t), y: safe(indicators.bbLower[i]) }) : safe(indicators.bbLower[i])),
            borderWidth: 1, pointRadius: 0
        });
    }

    if (showVolume) {
        const volData = candles.map((c, i) =>
            useTime ? ({ x: toMs(c.t), y: c.v }) : c.v
        );
        datasets.push({
            type: "bar",
            label: "Volume",
            data: volData,
            yAxisID: "y1",
            ...(useTime ? {} : { parsing: false }),
        });
    }

    if (showPsar) {
        const sarSeries = indicators.sarSeries || indicators.sar || indicators.psar;
        if (sarSeries) {
            datasets.push({
                type: "scatter",
                label: "Parabolic SAR",
                data: candles.map((c, i) =>
                    useTime ? ({ x: toMs(c.t), y: safe(sarSeries[i]) }) : safe(sarSeries[i])
                ),
                borderColor: "blue",
                backgroundColor: "blue",
                pointRadius: 2,
            });
        }
    }


    const options = {
        responsive: false,
        ...(useTime ? {} : { parsing: false }),
        plugins: { legend: { display: true } },
        scales: (() => {
            const base = useTime
                ? { x: { type: "time", time: { tooltipFormat: "yyyy-LL-dd HH:mm" } }, y: { type: "linear" } }
                : { x: { type: "category" }, y: { type: "linear" } };
            if (showVolume) {
                base.y1 = { type: "linear", position: "right", grid: { display: false } };
            }
            return base;
        })(),
    };

    const chartType = useTime || candlestickAvailable ? "candlestick" : "line";
    const cfg = {
        type: chartType,
        data: useTime ? { datasets } : { labels, datasets },
        options,
    };
    const buffer = await canvas.renderToBuffer(cfg);
    const outPath = `charts/${assetKey}_${tf}.png`;
    fs.writeFileSync(outPath, buffer);
    const ms = performance.now() - start;
    log.debug({ fn: 'renderChartPNG', ms }, 'duration');
    recordPerf('renderChartPNG', ms);
    return outPath;
}

/**
 * Renders a forecast chart combining historical closes with the predicted next close.
 * @param {object} params - Rendering parameters.
 * @param {string} params.assetKey - Asset identifier.
 * @param {string} params.timeframe - Timeframe label.
 * @param {number[]} params.closes - Close price history.
 * @param {Array<number|Date>} [params.timestamps=[]] - Optional candle timestamps aligned with closes.
 * @param {number} params.forecastValue - Predicted close value.
 * @param {number} [params.forecastTime] - Timestamp for the predicted close (ms since epoch).
 * @param {number} [params.confidence] - Optional confidence score in range [0, 1].
 * @param {object} [params.options={}] - Charting options including directory and history window.
 * @returns {Promise<string|null>} Absolute path to the generated PNG or null when rendering is skipped.
 */
export async function renderForecastChart({
    assetKey,
    timeframe,
    closes,
    timestamps = [],
    forecastValue,
    forecastTime,
    confidence,
    options = {},
}) {
    if (!assetKey || !timeframe || !Array.isArray(closes) || closes.length < 2) {
        return null;
    }
    if (!Number.isFinite(forecastValue)) {
        return null;
    }

    const start = performance.now();
    const log = withContext(logger, { asset: assetKey, timeframe, fn: 'renderForecastChart' });

    const historyPointsRaw = Number.isFinite(options.historyPoints) ? options.historyPoints : 120;
    const historyPoints = Math.max(2, Math.min(historyPointsRaw, closes.length));
    const startIndex = closes.length - historyPoints;
    const closeSlice = closes.slice(startIndex);
    const timestampSlice = Array.isArray(timestamps) && timestamps.length === closes.length
        ? timestamps.slice(startIndex).map(toMs)
        : [];
    const useTime = timestampSlice.length === closeSlice.length && timestampSlice.every(Number.isFinite);

    const baseX = useTime
        ? timestampSlice
        : Array.from({ length: closeSlice.length }, (_, idx) => idx);

    const actualData = baseX.map((x, idx) => ({ x, y: closeSlice[idx] }));
    const lastActual = actualData.at(-1);

    let computedForecastTime = Number.isFinite(forecastTime) ? forecastTime : null;
    if (useTime && !computedForecastTime) {
        let stepSum = 0;
        for (let i = 1; i < baseX.length; i += 1) {
            const diff = baseX[i] - baseX[i - 1];
            if (Number.isFinite(diff) && diff > 0) {
                stepSum += diff;
            }
        }
        const avgStep = stepSum > 0 && baseX.length > 1
            ? stepSum / (baseX.length - 1)
            : baseX.length > 1
                ? baseX[baseX.length - 1] - baseX[baseX.length - 2]
                : 0;
        if (Number.isFinite(avgStep) && avgStep !== 0) {
            computedForecastTime = baseX[baseX.length - 1] + avgStep;
        }
        if (!Number.isFinite(computedForecastTime) && baseX.length > 1) {
            const fallback = baseX[baseX.length - 1] - baseX[baseX.length - 2];
            if (Number.isFinite(fallback) && fallback !== 0) {
                computedForecastTime = baseX[baseX.length - 1] + fallback;
            }
        }
    }

    const predictedX = useTime
        ? (Number.isFinite(computedForecastTime)
            ? computedForecastTime
            : (lastActual?.x ?? Date.now()))
        : (lastActual?.x ?? (closeSlice.length - 1)) + 1;

    const forecastSeries = [];
    if (lastActual) {
        forecastSeries.push({ x: lastActual.x, y: lastActual.y });
    }
    forecastSeries.push({ x: predictedX, y: forecastValue });

    const directory = typeof options.directory === 'string' && options.directory.trim() !== ''
        ? options.directory.trim()
        : 'charts/forecasts';
    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true });
    }

    const confidenceLabel = Number.isFinite(confidence)
        ? `Forecast (${Math.round(confidence * 100)}%)`
        : 'Forecast';

    const datasets = [
        {
            type: 'line',
            label: `${assetKey} ${timeframe} Close`,
            data: actualData,
            borderColor: '#1f77b4',
            pointRadius: 0,
            tension: 0.25,
        },
        {
            type: 'line',
            label: confidenceLabel,
            data: forecastSeries,
            borderColor: '#ff7f0e',
            borderDash: [6, 4],
            pointRadius: 3,
            fill: false,
        },
    ];

    const chartOptions = {
        responsive: false,
        parsing: false,
        plugins: { legend: { display: true } },
        scales: useTime
            ? { x: { type: 'time', time: { tooltipFormat: 'yyyy-LL-dd HH:mm' } }, y: { type: 'linear' } }
            : { x: { type: 'linear' }, y: { type: 'linear' } },
    };

    const config = {
        type: 'line',
        data: { datasets },
        options: chartOptions,
    };

    const buffer = await canvas.renderToBuffer(config);
    const outPath = `${directory}/${assetKey}_${timeframe}_forecast.png`;
    fs.writeFileSync(outPath, buffer);
    const ms = performance.now() - start;
    recordPerf('renderForecastChart', ms);
    log.debug({ ms, forecastValue, predictedX }, 'Forecast chart rendered');
    return outPath;
}

/**
 * Renders a line chart summarizing the simulated portfolio growth progression.
 * @param {object} params - Rendering parameters.
 * @param {Array<object>} params.history - Portfolio history entries with timestamp, totalValue, cash and invested fields.
 * @param {number} params.targetCapital - Capital goal to plot as a reference line.
 * @param {object} [params.options={}] - Rendering options including directory and metric annotations.
 * @returns {Promise<string|null>} Absolute path to the generated PNG or null when rendering is skipped.
 */
export async function renderPortfolioGrowthChart({ history, targetCapital, options = {} }) {
    if (!Array.isArray(history) || history.length < 2) {
        return null;
    }

    const points = history
        .map((entry, index) => {
            const time = typeof entry.timestamp === "string"
                ? Date.parse(entry.timestamp)
                : Number.isFinite(entry.timestamp)
                    ? Number(entry.timestamp)
                    : null;
            const totalValue = Number.parseFloat(entry.totalValue ?? entry.value ?? NaN);
            const cash = Number.parseFloat(entry.cash ?? NaN);
            const invested = Number.parseFloat(entry.invested ?? (Number.isFinite(totalValue) && Number.isFinite(cash)
                ? totalValue - cash
                : NaN));
            const drawdown = Number.parseFloat(entry.drawdownPct ?? entry.drawdown ?? NaN);
            if (!Number.isFinite(totalValue) || time === null || !Number.isFinite(time)) {
                return null;
            }
            return {
                time,
                index,
                totalValue,
                cash: Number.isFinite(cash) ? cash : null,
                invested: Number.isFinite(invested) ? invested : null,
                drawdown: Number.isFinite(drawdown) ? drawdown : null,
            };
        })
        .filter(Boolean);

    if (points.length < 2) {
        return null;
    }

    const useTime = points.every(point => Number.isFinite(point.time));
    const baseX = points.map(point => useTime ? point.time : point.index);

    const valueSeries = points.map((point, idx) => ({ x: baseX[idx], y: point.totalValue }));
    const investedSeries = points.map((point, idx) => ({ x: baseX[idx], y: point.invested ?? point.totalValue }));
    const cashSeries = points
        .map((point, idx) => Number.isFinite(point.cash) ? ({ x: baseX[idx], y: point.cash }) : null)
        .filter(Boolean);
    const drawdownSeries = points
        .map((point, idx) => point.drawdown != null ? ({ x: baseX[idx], y: point.drawdown }) : null)
        .filter(Boolean);

    const directory = typeof options.directory === "string" && options.directory.trim() !== ""
        ? options.directory.trim()
        : "charts/growth";
    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true });
    }

    const datasets = [
        {
            type: "line",
            label: "Portfolio Value",
            data: valueSeries,
            borderColor: "#1f77b4",
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.25,
            yAxisID: "y",
        },
        {
            type: "line",
            label: "Invested Capital",
            data: investedSeries,
            borderColor: "#2ca02c",
            borderDash: [6, 4],
            pointRadius: 0,
            tension: 0.2,
            yAxisID: "y",
        },
    ];

    if (cashSeries.length > 0) {
        datasets.push({
            type: "line",
            label: "Cash Buffer",
            data: cashSeries,
            borderColor: "#ff7f0e",
            borderDash: [2, 2],
            pointRadius: 0,
            tension: 0.2,
            yAxisID: "y",
        });
    }

    if (Number.isFinite(targetCapital) && targetCapital > 0) {
        datasets.push({
            type: "line",
            label: `Meta ${targetCapital.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
            data: baseX.map((x) => ({ x, y: targetCapital })),
            borderColor: "#d62728",
            borderDash: [4, 4],
            pointRadius: 0,
            tension: 0,
            yAxisID: "y",
        });
    }

    if (drawdownSeries.length > 0) {
        datasets.push({
            type: "line",
            label: "Drawdown",
            data: drawdownSeries,
            borderColor: "#9467bd",
            borderWidth: 1,
            pointRadius: 0,
            yAxisID: "y1",
        });
    }

    const titleParts = ["Evolução do Portfólio"];
    if (Number.isFinite(options.cagr)) {
        titleParts.push(`CAGR ${(options.cagr * 100).toFixed(2)}%`);
    }
    if (Number.isFinite(options.maxDrawdownPct)) {
        titleParts.push(`Max DD ${(options.maxDrawdownPct * 100).toFixed(1)}%`);
    }

    const scales = useTime
        ? {
            x: { type: "time", time: { tooltipFormat: "yyyy-LL-dd" } },
            y: { type: "linear", title: { display: true, text: "Valor (€)" } },
        }
        : {
            x: { type: "linear" },
            y: { type: "linear", title: { display: true, text: "Valor (€)" } },
        };

    if (drawdownSeries.length > 0) {
        scales.y1 = {
            type: "linear",
            position: "right",
            grid: { display: false },
            ticks: {
                callback: (value) => `${(Number(value) * 100).toFixed(0)}%`,
            },
            min: 0,
            max: Math.min(1, Math.max(...drawdownSeries.map(point => point.y)) * 1.2 || 0.5),
            title: { display: true, text: "Drawdown" },
        };
    }

    const config = {
        type: "line",
        data: { datasets },
        options: {
            responsive: false,
            parsing: false,
            plugins: {
                legend: { display: true },
                title: { display: true, text: titleParts.join(" • ") },
                tooltip: { mode: "index", intersect: false },
            },
            scales,
        },
    };

    const start = performance.now();
    const buffer = await canvas.renderToBuffer(config);
    const lastTime = points.at(-1)?.time ?? Date.now();
    const outPath = `${directory}/portfolio_growth_${Math.round(lastTime)}.png`;
    fs.writeFileSync(outPath, buffer);
    const ms = performance.now() - start;
    recordPerf("renderPortfolioGrowthChart", ms);
    const log = withContext(logger, { fn: "renderPortfolioGrowthChart" });
    log.debug({ ms, outPath }, "Rendered portfolio growth chart");
    return outPath;
}

