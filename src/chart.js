// src/chart.js
import { Chart, registerables } from "chart.js";
import "chartjs-adapter-luxon";
// 👇 IMPORTA O BUILD ESM DO PLUGIN *POR SIDE-EFFECT* (0.2.1 não exporta controllers)
import "chartjs-chart-financial/dist/chartjs-chart-financial.esm.js";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import fs from "node:fs";

// 1) Regista os componentes base do Chart.js
Chart.register(...registerables);

// ATENÇÃO:
// O import acima do ESM DO PLUGIN já faz o registo dos tipos 'candlestick'/'ohlc'.
// NÃO tentes Chart.register(CandlestickController, ...) porque 0.2.1 não exporta isto.

const WIDTH = 1280;
const HEIGHT = 640;
const canvas = new ChartJSNodeCanvas({ width: WIDTH, height: HEIGHT });

export async function renderChartPNG(assetKey, tf, candles, indicators) {
    if (!fs.existsSync("charts")) fs.mkdirSync("charts", { recursive: true });

    // Chart financeiro espera [{x, o, h, l, c}]
    const ohlc = candles.map((c) => ({ x: c.t, o: c.o, h: c.h, l: c.l, c: c.c }));

    const datasets = [
        {
            type: "candlestick",          // ✅ suportado pelo plugin 0.2.1 após o import ESM
            label: `${assetKey} ${tf}`,
            data: ohlc,
            borderWidth: 1
        }
    ];

    const point = (y) => (y == null ? null : y);

    if (indicators?.ma20)
        datasets.push({
            type: "line",
            label: "SMA20",
            data: candles.map((c, i) => ({ x: c.t, y: point(indicators.ma20[i]) })),
            borderWidth: 1,
            pointRadius: 0
        });



    if (indicators?.ma50)
        datasets.push({
            type: "line",
            label: "SMA50",
            data: candles.map((c, i) => ({ x: c.t, y: point(indicators.ma50[i]) })),
            borderWidth: 1,
            pointRadius: 0
        });



    if (indicators?.ma200)
        datasets.push({
            type: "line",
            label: "SMA200",
            data: candles.map((c, i) => ({ x: c.t, y: point(indicators.ma200[i]) })),
            borderWidth: 1,
            pointRadius: 0
        });

    if (indicators?.bbUpper)
        datasets.push({
            type: "line",
            label: "BB Upper",
            data: candles.map((c, i) => ({ x: c.t, y: point(indicators.bbUpper[i]) })),
            borderWidth: 1,
            pointRadius: 0
        });

    if (indicators?.bbLower)
        datasets.push({
            type: "line",
            label: "BB Lower",
            data: candles.map((c, i) => ({ x: c.t, y: point(indicators.bbLower[i]) })),
            borderWidth: 1,
            pointRadius: 0
        });

    const cfg = {
        type: "candlestick",            // ✅ tipo do gráfico
        data: { datasets },
        options: {
            responsive: false,
            parsing: false,               // passamos {x,o,h,l,c}
            plugins: { legend: { display: true } },
            scales: {
                x: { type: "time", time: { tooltipFormat: "yyyy-LL-dd HH:mm" } },
                y: { display: true }
            }
        }
    };


    const buffer = await canvas.renderToBuffer(cfg);
    console.log("renderChartPNG called")

    const outPath = `charts/${assetKey}_${tf}.png`;
    fs.writeFileSync(outPath, buffer);
    return outPath;
}
