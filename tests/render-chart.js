import fs from "node:fs";
import { renderChartPNG } from "../src/chart.js";

const now = Date.now();
const candles = Array.from({ length: 10 }, (_, i) => {
    const t = now + i * 60 * 1000;
    const o = 100 + i;
    const h = o + 1;
    const l = o - 1;
    const c = o + 0.5;
    return { t, o, h, l, c };
});

const indicators = {
    ma20: candles.map(c => c.c),
    ma50: candles.map(c => c.c),
    ma200: candles.map(c => c.c),
    bbUpper: candles.map(c => c.c + 1),
    bbLower: candles.map(c => c.c - 1),
};

const out = await renderChartPNG("test", "test", candles, indicators);
fs.renameSync(out, "charts/test.png");
console.log("Chart saved to charts/test.png");
