import axios from "axios";
import { config, CFG } from "./config.js";
import { callOpenRouter } from "./ai.js";
import { fetchWithRetry } from "./utils.js";
import { logger, withContext, createContext } from "./logger.js";

const REPUTABLE_DOMAINS = [
    "coindesk.com",
    "cointelegraph.com",
    "decrypt.co",
    "theblock.co",
    "bloomberg.com",
    "reuters.com",
    "cnbc.com",
    "forbes.com",
];

function getDomain(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, "");
    } catch {
        return "";
    }
}

function parseDate(dateStr) {
    if (!dateStr) return null;
    const direct = new Date(dateStr);
    if (!isNaN(direct)) return direct;
    const now = new Date();
    const m = dateStr.match(/(\d+)\s*(min|hour|day)/i);
    if (m) {
        const val = parseInt(m[1], 10);
        if (m[2].startsWith("min")) return new Date(now - val * 60 * 1000);
        if (m[2].startsWith("hour")) return new Date(now - val * 60 * 60 * 1000);
        if (m[2].startsWith("day")) return new Date(now - val * 24 * 60 * 60 * 1000);
    }
    return null;
}

function dedupeByTrigram(items) {
    const seen = new Set();
    return items.filter(item => {
        const trigram = item.title.toLowerCase().split(/\s+/).slice(0, 3).join(" ");
        if (seen.has(trigram)) return false;
        seen.add(trigram);
        return true;
    });
}

function sortByRank(a, b) {
    const diff = b.publishedAt - a.publishedAt;
    if (diff !== 0) return diff;
    const aw = REPUTABLE_DOMAINS.indexOf(getDomain(a.url));
    const bw = REPUTABLE_DOMAINS.indexOf(getDomain(b.url));
    return bw - aw;
}

async function classifySentiments(items) {
    const titles = items.map(i => i.title);
    if (!titles.length) return [];
    if (CFG.openrouterApiKey) {
        const log = withContext(logger, createContext());
        try {
            const prompt = `Classify the sentiment of each headline as -1 for negative, 0 for neutral, and 1 for positive. Return a JSON array of numbers in the same order.\n` +
                titles.map(t => `- ${t}`).join("\n");
            const messages = [
                { role: "system", content: "You are a sentiment analysis assistant." },
                { role: "user", content: [{ type: "text", text: prompt }] }
            ];
            const resp = await callOpenRouter(messages);
            const arr = JSON.parse(resp);
            if (Array.isArray(arr)) {
                return arr.map(n => Math.max(-1, Math.min(1, Number(n) || 0)));
            }
        } catch (err) {
              log.error({ fn: 'classifySentiments', err }, "Sentiment classification via OpenRouter failed");
        }
    }
    const positive = ["up", "surge", "rally", "gain", "bull", "rise", "soar", "profit", "positive"];
    const negative = ["down", "drop", "fall", "crash", "bear", "decline", "plunge", "loss", "negative"];
    return titles.map(t => {
        const lc = t.toLowerCase();
        let score = 0;
        for (const w of positive) if (lc.includes(w)) score++;
        for (const w of negative) if (lc.includes(w)) score--;
        return score > 0 ? 1 : score < 0 ? -1 : 0;
    });
}

export async function getAssetNews({ symbol, lookbackHours = 24, limit = 6 }) {
    const log = withContext(logger, createContext({ asset: symbol }));
    log.info({ fn: 'getAssetNews' }, `Fetching news for ${symbol}`);
    if (!config.serpapiApiKey || !symbol) {
        return { items: [], summary: "", avgSentiment: 0 };
    }
    try {
        const params = {
            engine: "google_news",
            q: symbol,
            tbs: "qdr:d",
            api_key: config.serpapiApiKey,
            num: limit * 2,
        };
        const resp = await fetchWithRetry(() => axios.get("https://serpapi.com/search", { params }));
        const now = Date.now();
        const cutoff = now - lookbackHours * 60 * 60 * 1000;
        let items = (resp.data.news_results || []).map(n => {
            const date = parseDate(n.date);
            return {
                title: n.title,
                source: n.source || getDomain(n.link),
                publishedAt: date ? date : new Date(),
                url: n.link,
                snippet: n.snippet || "",
            };
        }).filter(n => n.publishedAt.getTime() >= cutoff);

        let filtered = items.filter(n => REPUTABLE_DOMAINS.includes(getDomain(n.url)));
        if (filtered.length < 2) filtered = items;

        filtered.sort(sortByRank);
        filtered = dedupeByTrigram(filtered).slice(0, limit);

        const sentiments = await classifySentiments(filtered);
        const avgSentiment = sentiments.length ? sentiments.reduce((a, b) => a + b, 0) / sentiments.length : 0;
        filtered = filtered.map((i, idx) => ({ ...i, sentiment: sentiments[idx] ?? 0 }));

        let summary = "";
        if (CFG.openrouterApiKey) {
            try {
                const prompt = `Summarize in a couple sentences the following news about ${symbol}:\n` +
                    filtered.map(i => `- ${i.title} (${i.source})`).join("\n");
                const messages = [
                    { role: "system", content: "You are a concise financial news assistant." },
                    { role: "user", content: [{ type: "text", text: prompt }] }
                ];
                summary = await callOpenRouter(messages);
            } catch {
                summary = "";
            }
        }
        if (!summary) {
            summary = filtered.slice(0, 3).map(i => `${i.source}: ${i.title}`).join(" | ");
        }

        // convert publishedAt to ISO strings
        const normalized = filtered.map(i => ({
            ...i,
            publishedAt: i.publishedAt.toISOString(),
        }));

        return { items: normalized, summary: summary.trim(), avgSentiment };
    } catch (error) {
          log.error({ fn: 'getAssetNews', err: error }, "Error fetching asset news");
        return { items: [], summary: "", avgSentiment: 0 };
    }
}
