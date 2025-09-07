// call openrouter ai
import OpenAi from "openai";
import axios from "axios";
import { CFG, config } from "./config.js";
import { ASSETS } from "./assets.js";
import { fetchOHLCV } from "./data/binance.js";
import { sma, rsi } from "./indicators.js";

const openrouter = new OpenAi({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: CFG.openrouterApiKey
});

export async function searchNews(asset) {
    if (!config.newsApiKey) return [];
    try {
        const resp = await axios.get("https://newsapi.org/v2/everything", {
            params: {
                q: asset,
                language: "en",
                sortBy: "publishedAt",
                pageSize: 3,
                apiKey: config.newsApiKey,
            },
        });
        return resp.data.articles.map(a => ({
            title: a.title,
            description: a.description || "",
        }));
    } catch (error) {
        console.error("Error fetching news:", error.message);
        return [];
    }
}

// OPnenRouter chat completion
export async function callOpenRouter(asset) {
    let message = [
        { role: "system", content: "You are a expert in trading analysis and investment. Your objective is help , giving advise to transform 10 euros into 1Million euros and grow from there" },
        { role: "user", content: `You are a crypto trading assistant. You will be given metrics for a cryptocurrency asset including price, volume, moving averages (MA20, MA50), Relative Strength Index (RSI14), and average volume over 20 periods (VolumeAvg20). You may also receive recent news headlines related to the asset. Based on these inputs, provide a concise recommendation to buy, sell, or hold the asset along with a brief reasoning for your decision. Keep your response under 100 words. Do this analysis for this asset: ${asset}` },
    ];
    try {
        const response = await openrouter.chat.completions.create({
            model: CFG.openrouterModel || "openrouter/sonoma-dusk-alpha",
            messages: message,
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

            const analysis = await callOpenRouter([
                { role: "system", content: "You are a crypto trading assistant." },
                { role: "user", content: prompt }
            ]);

            reports.push(`**${key}**\n${analysis.trim()}`);
        } catch (error) {
            reports.push(`**${key}**\nError: ${error.message}`);
        }
    }

    return reports.join("\n\n");
}
