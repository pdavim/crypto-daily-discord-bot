import cron from "node-cron";
import { CFG } from "./config.js";
import { ASSETS, TIMEFRAMES } from "./assets.js";
import { fetchOHLCV } from "./data/binance.js";
import { fetchOHLCV_TV } from "./data/tradingview.js";
import { sma, rsi, macd, bollinger, parabolicSAR, volumeDivergence } from "./indicators.js";
import { renderChartPNG } from "./chart.js";
import { buildSummary, neutralVerdict } from "./reporter.js";
import { sendDiscordReport } from "./discord.js";

function tfToBinance(tf) { return tf; } // mapeamento direto 4h/2h/1h/45m/30m/15m/5m

async function runOnceForAsset(asset) {
    for (const tf of TIMEFRAMES) {
        const source = CFG.mode === "tv" ? "tv" : "binance";
        const candles = source === "tv"
            ? await fetchOHLCV_TV(asset.tv, tf)  // ⚠️ usar apenas com permissão
            : await fetchOHLCV(asset.binance, tfToBinance(tf));

        if (!candles || candles.length < 100) continue;

        const close = candles.map(c => c.c), vol = candles.map(c => c.v);
        const ma20 = sma(close, 20), ma50 = sma(close, 50), ma200 = sma(close, 200);
        const r = rsi(close, 14);
        const m = macd(close, 12, 26, 9);
        const bb = bollinger(close, 20, 2);
        const sar = parabolicSAR(candles);
        const vdiv = volumeDivergence(close, vol, 20);

        const last = candles[candles.length - 1];
        const summary = buildSummary({
            assetKey: asset.key,
            tf,
            ohlc: last,
            returns: { d1: "—", d7: "—", d30: "—" }, // (podes calcular com séries diárias)
            tech: {
                ma: `${ma20.at(-1)?.toFixed(2)}/${ma50.at(-1)?.toFixed(2)}/${ma200.at(-1) ?? "—"}`,
                rsi: r.at(-1)?.toFixed(2),
                macd: `${m.line.at(-1)?.toFixed(4)}/${m.signal.at(-1)?.toFixed(4)}`,
                macdHist: m.hist.at(-1),
                bb: `μ ${bb.mid.at(-1)?.toFixed(2)} · σ± ${bb.upper.at(-1)?.toFixed(2)}/${bb.lower.at(-1)?.toFixed(2)}`,
                sar: sar.at(-1) ?? "—",
                vdiv: vdiv.at(-1)
            },
            macroNote: null,
            verdict: neutralVerdict({ rsi: r.at(-1), macdHist: m.hist.at(-1) })
        });

        const chartPath = await renderChartPNG(asset.key, tf, candles, {
            ma20, bbUpper: bb.upper, bbLower: bb.lower
        });

        await sendDiscordReport(asset.key, tf, summary, chartPath);
    }
}

async function runAll() {
    for (const a of ASSETS) {
        await runOnceForAsset(a);
    }
}

const ONCE = process.argv.includes("--once");

// Agendar: a cada 1h no minuto 00, TZ do .env
if (!ONCE) {
    cron.schedule("0 * * * *", runAll, { timezone: CFG.tz }); // a cada hora
    console.log(`⏱️ Agendado: 1×/hora (TZ=${CFG.tz}) | DATA_MODE=${CFG.mode}`);
    runAll(); // arranque imediato
} else {
    runAll();
}
