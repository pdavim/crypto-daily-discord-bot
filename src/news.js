import axios from "axios";
import { config, CFG } from "./config.js";
import { callOpenRouter } from "./ai.js";

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

export async function getAssetNews({ symbol, lookbackHours = 24, limit = 6 }) {
    if (!config.serpapiApiKey || !symbol) {
        return { items: [], summary: "" };
    }
    try {
        const params = {
            engine: "google_news",
            q: symbol,
            tbs: "qdr:d",
            api_key: config.serpapiApiKey,
            num: limit * 2,
        };
        const resp = await axios.get("https://serpapi.com/search", { params });
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

        let summary = "";
        if (CFG.openrouterApiKey) {
            try {
                const prompt = `Summarize in a couple sentences the following news about ${symbol}:\n` +
                    filtered.map(i => `- ${i.title} (${i.source})`).join("\n");
                const messages = [
                    { role: "system", content: "You are a concise financial news assistant." },
                    { role: "user", content: prompt }
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

        return { items: normalized, summary: summary.trim() };
    } catch (error) {
        console.error("Error fetching asset news:", error.message);
        return { items: [], summary: "" };
    }
}
