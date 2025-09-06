import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import Chart from "chart.js/auto";
import fs from "node:fs";

const WIDTH = 1280, HEIGHT = 640;
const canvas = new ChartJSNodeCanvas({ width: WIDTH, height: HEIGHT });

export async function renderChartPNG(assetKey, tf, candles, indicators) {
    // candles: [{t,o,h,l,c,v}, ...]
    const labels = candles.map(c => c.t.toISOString().replace('T', ' ').slice(0, 16));
    const close = candles.map(c => c.c);

    const cfg = {
        type: "line",
        data: {
            labels,
            datasets: [
                { label: `${assetKey} Close`, data: close, borderWidth: 2, pointRadius: 0 },
                indicators.ma20 ? { label: "MA20", data: indicators.ma20, borderWidth: 1, pointRadius: 0 } : null,
                indicators.bbUpper ? { label: "BB Upper", data: indicators.bbUpper, borderWidth: 1, pointRadius: 0 } : null,
                indicators.bbLower ? { label: "BB Lower", data: indicators.bbLower, borderWidth: 1, pointRadius: 0 } : null
            ].filter(Boolean)
        },
        options: { responsive: false, plugins: { legend: { display: true } }, scales: { x: { display: true }, y: { display: true } } }
    };

    const buffer = await canvas.renderToBuffer(cfg);
    const outPath = `charts/${assetKey}_${tf}.png`;
    fs.writeFileSync(outPath, buffer);
    return outPath;
}
