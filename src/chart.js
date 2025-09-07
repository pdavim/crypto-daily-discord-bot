// src/chart.js
import { Chart, registerables } from "chart.js";
import {
    LineController, LineElement, PointElement,
    LinearScale, CategoryScale, TimeScale, TimeSeriesScale,
    Filler, Tooltip, Legend
} from "chart.js";
import "chartjs-adapter-luxon";
// IMPORTANT: Use the ESM build so it auto-registers candlestick/ohlc on THIS Chart
import "chartjs-chart-financial/dist/chartjs-chart-financial.esm.js";

import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import fs from "node:fs";

// Register base bits explicitly (safer on Node)
Chart.register(
    LineController, LineElement, PointElement,
    LinearScale, CategoryScale, TimeScale, TimeSeriesScale,
    Filler, Tooltip, Legend
);

const WIDTH = 1280, HEIGHT = 640;

// Use THIS Chart instance inside chartjs-node-canvas
const canvas = new ChartJSNodeCanvas({
    width: WIDTH,
    height: HEIGHT,
    chartJs: Chart, // ← critical
});



function toMs(x) { return x instanceof Date ? x.getTime() : +x; }
function adapterReady() {
    const a = Chart?._adapters?.date;
    return a && typeof a.parse === "function" && typeof a.format === "function";
}
function isCandlestickRegistered() {
    try { return !!Chart.registry.controllers.get("candlestick"); }
    catch { return false; }
}

export async function renderChartPNG(assetKey, tf, candles, indicators) {

    if (!fs.existsSync("charts")) fs.mkdirSync("charts", { recursive: true });

    const hasAdapter = adapterReady();
    const hasCandle = isCandlestickRegistered();
    console.log("candlestick registered?",
        hasCandle ? "yes" : "NO! (falling back to line)",
        "| date adapter?", hasAdapter ? "yes" : "NO! (using categories)");
    // Common x values as epoch ms (avoids extra parsing)
    const xs = candles.map(c => toMs(c.t));

    // Build datasets depending on availability
    const datasets = [];

    if (hasCandle) {
        // Candlestick dataset expects {x,o,h,l,c}
        const ohlc = candles.map(c => ({ x: toMs(c.t), o: c.o, h: c.h, l: c.l, c: c.c }));
        datasets.push({
            type: "candlestick",
            label: `${assetKey} ${tf}`,
            data: ohlc,
            borderWidth: 1
        });
    } else {
        // Graceful fallback: line on Close
        datasets.push({
            type: "line",
            label: `${assetKey} ${tf} (Close)`,
            data: candles.map(c => ({ x: toMs(c.t), y: c.c })),
            borderWidth: 1,
            pointRadius: 0
        });
        // Helpful console hint
        console.warn("[chart] candlestick controller not registered — falling back to line. " +
            "Ensure you installed chartjs-chart-financial@0.2.1 and import its ESM build.");
    }

    const safe = v => (v == null ? null : v);

    // Overlays (work for both candle and line)
    if (indicators?.ma20) {
        datasets.push({
            type: "line", label: "SMA20",
            data: candles.map((c, i) => ({ x: toMs(c.t), y: safe(indicators.ma20[i]) })),
            borderWidth: 1, pointRadius: 0
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

    const cfg = {
        type: hasCandle ? "candlestick" : "line",
        data: { datasets },
        options: {
            responsive: false,
            parsing: false,
            plugins: { legend: { display: true } },
            scales: hasAdapter ? {
                x: { type: "time", time: { tooltipFormat: "yyyy-LL-dd HH:mm" } },
                y: { type: "linear", display: true }
            } : {
                // if adapter ever goes missing, still render with categories
                x: { type: "category", labels: xs.map(t => new Date(t).toISOString().slice(0, 16)) },
                y: { type: "linear", display: true }
            }
        }
    };

    const buffer = await canvas.renderToBuffer(cfg);
    const outPath = `charts/${assetKey}_${tf}.png`;
    fs.writeFileSync(outPath, buffer);
    return outPath;
}
