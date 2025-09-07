// call openrouter ai
import OpenAi from "openai";
import { CFG } from "./config.js";
import { ASSETS } from "./assets.js";
import { fetchOHLCV } from "./data/binance.js";
import { searchNews } from "./data/newsapi.js";
import { sma, rsi } from "./indicators.js";

const openrouter = new OpenAi({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: CFG.openrouterApiKey
});

// OpenRouter chat completion
export async function callOpenRouter(messages) {
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

// Gather metrics for several assets and use OpenRouter for a brief analysis
export async function runAgent() {
    const reports = [];

    for (const { key, binance } of ASSETS) {
        try {
            if (!binance) {
                reports.push(`**${key}**\nNo Binance symbol configured.`);
                continue;
            }

            const candles = await fetchOHLCV(binance, "1h");
            if (!candles.length) {
                reports.push(`**${key}**\nNo candle data.`);
                continue;
            }

            const closes = candles.map(c => c.c);
            const volumes = candles.map(c => c.v);
            const last = candles.at(-1);

            const ma20 = sma(closes, 20).at(-1);
            const ma50 = sma(closes, 50).at(-1);
            const rsi14 = rsi(closes, 14).at(-1);
            const volAvg20 = sma(volumes, 20).at(-1);

            const news = await searchNews(key);
            const newsPrompt = news.length
                ? `News:\n${news.map(n => `- ${n.title}: ${n.description}`).join("\n")}\n`
                : "";

            const prompt = `Asset: ${key}\n` +
                `Price: ${last.c}\n` +
                `Volume: ${last.v}\n` +
                `MA20: ${ma20}\n` +
                `MA50: ${ma50}\n` +
                `RSI14: ${rsi14}\n` +
                `VolumeAvg20: ${volAvg20}\n` +
                newsPrompt +
                `Given these metrics and news, should we buy, sell, or hold ${key}? ` +
                `Provide a short reasoning.`;

            const messages = [
                { role: "system", content: "You are a crypto trading assistant." },
                { role: "user", content: prompt }
            ];

            const analysis = await callOpenRouter(messages);

            reports.push(`**${key}**\n${analysis.trim()}`);
        } catch (error) {
            reports.push(`**${key}**\nError: ${error.message}`);
        }
    }

    return reports.join("\n\n");
}
