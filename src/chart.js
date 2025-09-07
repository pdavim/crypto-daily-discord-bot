// src/chart.js
import { Chart, registerables } from "chart.js";
import "chartjs-adapter-luxon";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import fs from "node:fs";
import {
    CandlestickController,
    CandlestickElement,
} from "chartjs-chart-financial/dist/chartjs-chart-financial.esm.js";

// register Chart.js components
Chart.register(
    ...registerables,
    CandlestickController,
    CandlestickElement,
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

// renderização
export async function renderChartPNG(assetKey, tf, candles, indicators) {
    if (!fs.existsSync("charts")) fs.mkdirSync("charts", { recursive: true });

    const useTime = hasTimeAdapter();
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
    } else {
        const ohlc = candles.map(c => ({ o: c.o, h: c.h, l: c.l, c: c.c }));
        datasets.push({
            type: "candlestick",
            label: `${assetKey} ${tf}`,
            data: ohlc,
            borderWidth: 1,
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
        plugins: { legend: { display: true } },
        scales: useTime
            ? { x: { type: "time", time: { tooltipFormat: "yyyy-LL-dd HH:mm" } }, y: { type: "linear" } }
            : { x: { type: "category" }, y: { type: "linear" } },
    };

    const cfg = {
        type: "candlestick",
        data: useTime ? { datasets } : { labels, datasets },
        options,
    };
    const buffer = await canvas.renderToBuffer(cfg);
    const outPath = `charts/${assetKey}_${tf}.png`;
    fs.writeFileSync(outPath, buffer);
    return outPath;
}
