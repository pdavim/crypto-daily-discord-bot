// call openrouter ai
import OpenAi from "openai";
import { CFG } from "./config.js";
import { ASSETS } from "./assets.js";
import { fetchOHLCV } from "./data/binance.js";
import { getAssetNews } from "./news.js";
import { searchWeb } from "./websearch.js";
import { sma, rsi } from "./indicators.js";

const openrouter = CFG.openrouterApiKey
    ? new OpenAi({ baseURL: 'https://openrouter.ai/api/v1', apiKey: CFG.openrouterApiKey })
    : null;

// OpenRouter chat completion
export async function callOpenRouter(messages) {
    if (!openrouter) {
        throw new Error("OpenRouter API key missing");
    }
    try {
        const response = await openrouter.chat.completions.create({
            model: CFG.openrouterModel || "openrouter/sonoma-dusk-alpha",
            messages,
        });
        return response.choices[0].message.content;
    } catch (error) {
        console.error("Error calling OpenRouter:", error);
        throw error;
    }
}

function calcReturn(closes, days) {
    const last = closes.at(-1);
    const prev = closes.at(-(days + 1));
    if (!last || !prev) return 0;
    return ((last - prev) / prev) * 100;
}

function fallbackVerdict({ ma20, ma50, rsi14 }) {
    if (ma20 > ma50 && rsi14 > 55) {
        return "📈 Uptrend with bullish momentum.";
    }
    if (ma20 < ma50 && rsi14 < 45) {
        return "📉 Downtrend with weak momentum.";
    }
    return "🔁 Mixed technical signals, hold.";
}

async function getMacroContext() {
    try {
        const { summary } = await getAssetNews({ symbol: "crypto market" });
        const web = await searchWeb("crypto market");
        return [summary, web.slice(0, 2).join(" | ")].filter(Boolean).join(" | ");
    } catch {
        return "";
    }
}

// Gather metrics for several assets and use OpenRouter for a brief analysis
export async function runAgent() {
    const reports = [];
    const macro = await getMacroContext();

    for (const { key, binance } of ASSETS) {
        try {
            if (!binance) {
                reports.push(`**${key}**\n- No Binance symbol configured.`);
                continue;
            }

            const hourly = await fetchOHLCV(binance, "1h");
            const daily = await fetchOHLCV(binance, "1d");
            if (!hourly.length || !daily.length) {
                reports.push(`**${key}**\n- No candle data.`);
                continue;
            }

            const closesH = hourly.map(c => c.c);

            const ma20 = sma(closesH, 20).at(-1);
            const ma50 = sma(closesH, 50).at(-1);
            const rsi14 = rsi(closesH, 14).at(-1);

            const lastDaily = daily.at(-1);
            const dailyCloses = daily.map(c => c.c);
            const ret1d = calcReturn(dailyCloses, 1);
            const ret7d = calcReturn(dailyCloses, 7);
            const ret30d = calcReturn(dailyCloses, 30);

            const { summary: newsSummary } = await getAssetNews({ symbol: key });
            const webSnips = await searchWeb(key);

            const prompt = `Asset: ${key}\n` +
                `OHLCV: O:${lastDaily.o} H:${lastDaily.h} L:${lastDaily.l} C:${lastDaily.c} V:${lastDaily.v}\n` +
                `Returns: 24h ${ret1d.toFixed(2)}% 7d ${ret7d.toFixed(2)}% 30d ${ret30d.toFixed(2)}%\n` +
                `MA20: ${ma20} MA50: ${ma50} RSI14: ${rsi14}\n` +
                `News: ${newsSummary}\n` +
                `Web: ${webSnips.join(' | ')}\n` +
                `Macro: ${macro}\n` +
                `Give a verdict (📈 bullish, 📉 bearish, 🔁 neutral) with 1-2 line justification.`;

            let verdict = "";
            if (openrouter) {
                try {
                    const messages = [
                        { role: "system", content: "You are a crypto trading assistant." },
                        { role: "user", content: prompt }
                    ];
                    verdict = await callOpenRouter(messages);
                } catch {
                    verdict = "";
                }
            }
            if (!verdict) {
                verdict = fallbackVerdict({ ma20, ma50, rsi14 });
            }

            const report = [
                `**${key}**`,
                `- Price: ${lastDaily.c} (O:${lastDaily.o} H:${lastDaily.h} L:${lastDaily.l} V:${lastDaily.v})`,
                `- Returns: 24h ${ret1d.toFixed(2)}%, 7d ${ret7d.toFixed(2)}%, 30d ${ret30d.toFixed(2)}%`,
                `- Technicals: MA20 ${ma20?.toFixed(2)}, MA50 ${ma50?.toFixed(2)}, RSI14 ${rsi14?.toFixed(2)}`,
                `- News: ${newsSummary || 'n/a'}`,
                `- Web: ${webSnips.slice(0, 2).join(' | ') || 'n/a'}`,
                `- Macro: ${macro || 'n/a'}`,
                `- Verdict: ${verdict.trim()}`,
            ].join("\n");

            reports.push(report);
        } catch (error) {
            reports.push(`**${key}**\n- Error: ${error.message}`);
        }
    }

    const macroSection = macro ? `**Macro**\n${macro}` : "";
    const disclaimer = "_This report is for educational purposes only and not financial advice._";
    return [reports.join("\n\n"), macroSection, disclaimer].filter(Boolean).join("\n\n");
}
