// src/chart.js
// src/chart.js
import { Chart } from "chart.js";
import {
    LineController, LineElement, PointElement,
    LinearScale, CategoryScale, TimeScale, TimeSeriesScale,
    Filler, Tooltip, Legend
} from "chart.js";
import "chartjs-adapter-luxon";
// usa a versão ESM do plugin para registar candlestick/ohlc
import "chartjs-chart-financial/dist/chartjs-chart-financial.esm.js";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import fs from "node:fs";

// registar componentes base
Chart.register(
    LineController, LineElement, PointElement,
    LinearScale, CategoryScale, TimeScale, TimeSeriesScale,
    Filler, Tooltip, Legend
);

// injeta o Chart configurado no canvas
const canvas = new ChartJSNodeCanvas({
    width: 1280,
    height: 640,
    chartJs: Chart,
});

// utilitários
const toMs = (x) => (x instanceof Date ? x.getTime() : +x);
const safe = (y) => (y == null ? null : y);
const hasTimeAdapter = () => {
    const a = Chart?._adapters?.date;
    return !!(a && typeof a.parse === "function");
};
const hasCandlestick = () => {
    try { return !!Chart.registry.controllers.get("candlestick"); }
    catch { return false; }
};

// renderização
export async function renderChartPNG(assetKey, tf, candles, indicators) {
    if (!fs.existsSync("charts")) fs.mkdirSync("charts", { recursive: true });

    const xs = candles.map(c => toMs(c.t));
    const useCandle = hasCandlestick();
    const useTime = hasTimeAdapter();

    const datasets = [];

    if (useCandle) {
        const ohlc = candles.map(c => ({
            x: toMs(c.t), o: c.o, h: c.h, l: c.l, c: c.c,
        }));
        datasets.push({ type: "candlestick", label: `${assetKey} ${tf}`, data: ohlc, borderWidth: 1 });
    } else {
        // fallback: linha do preço de fecho
        datasets.push({
            type: "line", label: `${assetKey} ${tf} (Close)`,
            data: candles.map(c => ({ x: toMs(c.t), y: c.c })),
            borderWidth: 1, pointRadius: 0,
        });
    }

    // linhas de indicadores (SMA, Bollinger, etc.)
    if (indicators?.ma20) {
        datasets.push({
            type: "line", label: "SMA20",
            data: candles.map((c, i) => ({ x: toMs(c.t), y: safe(indicators.ma20[i]) })),
            borderWidth: 1, pointRadius: 0,
        });
    }

    if (indicators?.ma50) {
        datasets.push({
            type: "line", label: "SMA50",
            data: candles.map((c, i) => ({ x: toMs(c.t), y: safe(indicators.ma50[i]) })),
            borderWidth: 1, pointRadius: 0
        });
    }
    if (indicators?.ma200) {
        datasets.push({
            type: "line", label: "SMA200",
            data: candles.map((c, i) => ({ x: toMs(c.t), y: safe(indicators.ma200[i]) })),
            borderWidth: 1, pointRadius: 0
        });
    }
    if (indicators?.bbUpper) {
        datasets.push({
            type: "line", label: "BB Upper",
            data: candles.map((c, i) => ({ x: toMs(c.t), y: safe(indicators.bbUpper[i]) })),
            borderWidth: 1, pointRadius: 0
        });
    }
    if (indicators?.bbLower) {
        datasets.push({
            type: "line", label: "BB Lower",
            data: candles.map((c, i) => ({ x: toMs(c.t), y: safe(indicators.bbLower[i]) })),
            borderWidth: 1, pointRadius: 0
        });
    }


    const options = {
        responsive: false,
        parsing: false,
        plugins: { legend: { display: true } },
        scales: useTime
            ? { x: { type: "time", time: { tooltipFormat: "yyyy-LL-dd HH:mm" } }, y: { type: "linear" } }
            : { x: { type: "category", labels: xs.map(t => new Date(t).toISOString().slice(0, 16)) }, y: { type: "linear" } },
    };

    console.log(useCandle ? "Using candlestick chart" : "Using line chart");
    const cfg = { type: useCandle ? "candlestick" : "line", data: { datasets }, options };
    const buffer = await canvas.renderToBuffer(cfg);
    const outPath = `charts/${assetKey}_${tf}.png`;
    fs.writeFileSync(outPath, buffer);
    return outPath;
}
