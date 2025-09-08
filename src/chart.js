// src/chart.js
import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import fs from "node:fs";
import "chartjs-adapter-luxon";
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
export async function renderChartPNG(assetKey, tf, candles, indicators) {
    if (!fs.existsSync("charts")) fs.mkdirSync("charts", { recursive: true });
    const timeAdapter = hasTimeAdapter();
    const candlestickAvailable = !!Chart.registry.controllers.get("candlestick");
    console.log("candlestick:", candlestickAvailable);
    console.log("time adapter:", timeAdapter);
    const useTime = timeAdapter;
    const labels = !useTime
        ? candles.map(c => new Date(toMs(c.t)).toISOString().slice(0, 16))
        : undefined;

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
    if (indicators?.ma20) {
        datasets.push({
            type: "line", label: "SMA20",
            data: candles.map((c, i) => useTime ? ({ x: toMs(c.t), y: safe(indicators.ma20[i]) }) : safe(indicators.ma20[i])),
            borderWidth: 1, pointRadius: 0,
        });
    }

    if (indicators?.ma50) {
        datasets.push({
            type: "line", label: "SMA50",
            data: candles.map((c, i) => useTime ? ({ x: toMs(c.t), y: safe(indicators.ma50[i]) }) : safe(indicators.ma50[i])),
            borderWidth: 1, pointRadius: 0
        });
    }
    if (indicators?.ma200) {
        datasets.push({
            type: "line", label: "SMA200",
            data: candles.map((c, i) => useTime ? ({ x: toMs(c.t), y: safe(indicators.ma200[i]) }) : safe(indicators.ma200[i])),
            borderWidth: 1, pointRadius: 0
        });
    }
    if (indicators?.bbUpper) {
        datasets.push({
            type: "line", label: "BB Upper",
            data: candles.map((c, i) => useTime ? ({ x: toMs(c.t), y: safe(indicators.bbUpper[i]) }) : safe(indicators.bbUpper[i])),
            borderWidth: 1, pointRadius: 0
        });
    }
    if (indicators?.bbLower) {
        datasets.push({
            type: "line", label: "BB Lower",
            data: candles.map((c, i) => useTime ? ({ x: toMs(c.t), y: safe(indicators.bbLower[i]) }) : safe(indicators.bbLower[i])),
            borderWidth: 1, pointRadius: 0
        });
    }


    const options = {
        responsive: false,
        ...(useTime ? {} : { parsing: false }),
        plugins: { legend: { display: true } },
        scales: useTime
            ? { x: { type: "time", time: { tooltipFormat: "yyyy-LL-dd HH:mm" } }, y: { type: "linear" } }
            : { x: { type: "category" }, y: { type: "linear" } },
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
    return outPath;
}
