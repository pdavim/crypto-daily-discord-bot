import axios from "axios";
import Parser from "rss-parser";
import translate from "@vitalets/google-translate-api";
import { readFile, writeFile } from "node:fs/promises";
import { config, CFG } from "./config.js";
import { callOpenRouter } from "./ai.js";
import { fetchWithRetry } from "./utils.js";
import { logger, withContext } from "./logger.js";
import { filterFreshNewsItems, markNewsItemsAsSeen } from "./newsCache.js";
import { classifySentimentsLocal, normalizeSentiment, clampSentiment } from "./sentiment.js";

const NEWS_CACHE_PATH = new URL("../data/news-cache.json", import.meta.url);
const NEWS_CACHE_TTL_MS = 60 * 60 * 1000;
const rssParser = new Parser({ timeout: 15000 });

let newsCache = {};
let cacheLoaded = false;
let cacheLoadPromise;

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

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function ensureNewsCacheLoaded(log = withContext(logger)) {
    if (cacheLoaded) {
        return;
    }
    if (!cacheLoadPromise) {
        cacheLoadPromise = (async () => {
            try {
                const raw = await readFile(NEWS_CACHE_PATH, "utf8");
                const parsed = JSON.parse(raw);
                newsCache = isPlainObject(parsed) ? parsed : {};
            } catch (err) {
                if (err?.code !== "ENOENT") {
                    log.warn({ fn: "ensureNewsCacheLoaded", err }, "Failed to load news cache; starting with empty cache");
                }
                newsCache = {};
            }
            cacheLoaded = true;
        })();
    }
    await cacheLoadPromise;
}

async function persistNewsCache(log = withContext(logger)) {
    try {
        await writeFile(NEWS_CACHE_PATH, JSON.stringify(newsCache, null, 2));
    } catch (err) {
        log.error({ fn: "persistNewsCache", err }, "Failed to persist news cache");
    }
}

function cloneResult(data) {
    return JSON.parse(JSON.stringify(data));
}

async function getCachedNews(cacheKey, now, log) {
    await ensureNewsCacheLoaded(log);
    const entry = newsCache?.[cacheKey];
    if (!entry) {
        return null;
    }
    if (typeof entry.timestamp !== "number" || now - entry.timestamp > NEWS_CACHE_TTL_MS) {
        delete newsCache[cacheKey];
        await persistNewsCache(log);
        return null;
    }
    return cloneResult(entry.data);
}

async function setCachedNews(cacheKey, data, now, log) {
    await ensureNewsCacheLoaded(log);
    newsCache[cacheKey] = {
        timestamp: now,
        data: cloneResult(data),
    };
    await persistNewsCache(log);
}

function getCacheKey(symbol, lookbackHours, limit) {
    return `${(symbol || "").toLowerCase()}:${lookbackHours}:${limit}`;
}

function normalizeList(value, transform = (v) => v) {
    if (!value && value !== 0) return null;
    const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [value];
    const normalized = list
        .map((item) => transform(String(item).trim()))
        .filter(Boolean);
    if (!normalized.length) {
        return null;
    }
    normalized.sort((a, b) => a.localeCompare(b));
    return normalized;
}

function normalizeSymbolList(value) {
    const symbols = normalizeList(value, (v) => v.toUpperCase());
    return symbols;
}

function normalizeKeywordList(value) {
    const keywords = normalizeList(value, (v) => v.toLowerCase());
    return keywords;
}

async function translateNewsItems(items, log = withContext(logger)) {
    if (!Array.isArray(items) || !items.length) {
        return items;
    }

    const cache = new Map();

    const translateText = async (text, to) => {
        if (!text || typeof text !== "string") {
            return { text: "" };
        }
        const normalized = text.trim();
        if (!normalized) {
            return { text: "" };
        }
        const key = `${to}:${normalized}`;
        if (cache.has(key)) {
            return cache.get(key);
        }
        try {
            const result = await translate(normalized, { to });
            cache.set(key, result);
            return result;
        } catch (err) {
            log.warn({ fn: "translateNewsItems", to, err }, "Failed to translate text");
            const fallback = { text: normalized };
            cache.set(key, fallback);
            return fallback;
        }
    };

    const translated = [];
    for (const item of items) {
        const title = typeof item?.title === "string" ? item.title : "";
        const snippet = typeof item?.snippet === "string" ? item.snippet : "";

        const titleEnResult = title ? await translateText(title, "en") : { text: "" };
        const titlePtResult = title ? await translateText(title, "pt") : { text: "" };
        const snippetEnResult = snippet ? await translateText(snippet, "en") : { text: "" };
        const snippetPtResult = snippet ? await translateText(snippet, "pt") : { text: "" };

        let originalLanguage = titleEnResult?.from?.language?.iso
            || snippetEnResult?.from?.language?.iso
            || "unknown";
        if (!originalLanguage || originalLanguage === "auto") {
            originalLanguage = "unknown";
        }

        translated.push({
            ...item,
            originalLanguage,
            translations: {
                title: {
                    en: titleEnResult?.text ?? title,
                    pt: titlePtResult?.text ?? title,
                },
                snippet: {
                    en: snippetEnResult?.text ?? snippet,
                    pt: snippetPtResult?.text ?? snippet,
                },
            },
        });
    }

    return translated;
}

function getRssSourceEntries(symbol) {
    const sources = CFG.rssSources;
    if (!sources) {
        return [];
    }
    const symbolUpper = symbol ? symbol.toUpperCase() : "";
    const results = [];

    const pushEntry = (entry) => {
        if (!entry && entry !== 0) {
            return;
        }
        if (Array.isArray(entry)) {
            for (const value of entry) {
                pushEntry(value);
            }
            return;
        }
        if (typeof entry === "string") {
            const trimmed = entry.trim();
            if (trimmed) {
                results.push({ url: trimmed });
            }
            return;
        }
        if (!isPlainObject(entry)) {
            return;
        }

        const url = entry.url || entry.href || entry.link;
        if (!url) {
            return;
        }

        const includeSymbols = normalizeSymbolList(entry.symbols ?? entry.includeSymbols);
        if (includeSymbols && includeSymbols.length && symbolUpper) {
            if (!includeSymbols.includes(symbolUpper) && !includeSymbols.includes("*")) {
                return;
            }
        }

        const excludeSymbols = normalizeSymbolList(entry.excludeSymbols);
        if (excludeSymbols && excludeSymbols.length && symbolUpper && excludeSymbols.includes(symbolUpper)) {
            return;
        }

        const includeKeywords = normalizeKeywordList(entry.keywords ?? entry.includeKeywords);
        const excludeKeywords = normalizeKeywordList(entry.excludeKeywords);

        results.push({
            url,
            includeKeywords,
            excludeKeywords,
            name: entry.name,
        });
    };

    if (Array.isArray(sources) || typeof sources === "string") {
        pushEntry(sources);
    } else if (isPlainObject(sources)) {
        const candidates = [];
        if (symbolUpper && sources[symbolUpper]) {
            candidates.push(sources[symbolUpper]);
        }
        if (symbol && sources[symbol]) {
            candidates.push(sources[symbol]);
        }
        if (sources["*"]) {
            candidates.push(sources["*"]);
        }
        if (sources.default) {
            candidates.push(sources.default);
        }
        if (!candidates.length) {
            for (const value of Object.values(sources)) {
                pushEntry(value);
            }
        } else {
            for (const value of candidates) {
                pushEntry(value);
            }
        }
    }

    const seen = new Set();
    return results.filter((entry) => {
        const key = JSON.stringify([
            entry.url,
            entry.name,
            entry.includeKeywords ?? [],
            entry.excludeKeywords ?? [],
        ]);
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

async function fetchSerpApiNews({ symbol, lookbackHours, limit, log }) {
    if (!config.serpapiApiKey) {
        return [];
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
        return (resp.data.news_results || [])
            .map((n) => {
                let date = parseDate(n.date);
                if (!date || Number.isNaN(date.getTime())) {
                    date = new Date();
                }
                return {
                    title: n.title,
                    source: n.source || getDomain(n.link),
                    publishedAt: date,
                    url: n.link,
                    snippet: n.snippet || "",
                };
            })
            .filter((item) => item && item.publishedAt.getTime() >= cutoff);
    } catch (err) {
        log.error({ fn: "fetchSerpApiNews", err }, "Failed to fetch SerpAPI news");
        return [];
    }
}

function keywordsMatch(text, includeKeywords, excludeKeywords) {
    if (!text) {
        return !includeKeywords || includeKeywords.length === 0;
    }
    const normalized = text.toLowerCase();
    if (includeKeywords && includeKeywords.length && !includeKeywords.some((keyword) => normalized.includes(keyword))) {
        return false;
    }
    if (excludeKeywords && excludeKeywords.some((keyword) => normalized.includes(keyword))) {
        return false;
    }
    return true;
}

async function fetchRssNews({ symbol, lookbackHours, limit, log }) {
    const sources = getRssSourceEntries(symbol);
    if (!sources.length) {
        return [];
    }
    const cutoff = Date.now() - lookbackHours * 60 * 60 * 1000;
    const items = [];
    const seenUrls = new Set();

    for (const source of sources) {
        const { url } = source;
        if (!url) {
            continue;
        }
        try {
            const feed = await fetchWithRetry(() => rssParser.parseURL(url));
            const sourceName = source.name || feed?.title || getDomain(url);
            for (const item of feed?.items ?? []) {
                const title = item?.title?.trim();
                if (!title) {
                    continue;
                }
                const link = item?.link || item?.guid || item?.id;
                if (!link || seenUrls.has(link)) {
                    continue;
                }
                const dateStr = item?.isoDate || item?.pubDate || item?.pubdate || item?.date || item?.updated;
                const publishedAt = parseDate(dateStr);
                if (!publishedAt || Number.isNaN(publishedAt.getTime())) {
                    continue;
                }
                if (publishedAt.getTime() < cutoff) {
                    continue;
                }
                const snippetSource = item?.contentSnippet || item?.summary || (typeof item?.content === "string" ? item.content : "");
                const snippet = typeof snippetSource === "string" ? snippetSource.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : "";
                const keywordText = `${title} ${snippet}`.trim();
                if (!keywordsMatch(keywordText, source.includeKeywords, source.excludeKeywords)) {
                    continue;
                }
                seenUrls.add(link);
                items.push({
                    title,
                    source: sourceName || getDomain(link),
                    publishedAt,
                    url: link,
                    snippet,
                });
            }
        } catch (err) {
            log.error({ fn: "fetchRssNews", url, err }, "Failed to fetch RSS feed");
        }
    }

    items.sort((a, b) => b.publishedAt - a.publishedAt);
    const numericLimit = Number(limit);
    const effectiveLimit = Number.isFinite(numericLimit) && numericLimit > 0 ? numericLimit : 6;
    const maxItems = Math.max(effectiveLimit * 4, effectiveLimit);
    return items.slice(0, maxItems);
}

function sortByRank(a, b) {
    const diff = b.publishedAt - a.publishedAt;
    if (diff !== 0) return diff;
    const aw = REPUTABLE_DOMAINS.indexOf(getDomain(a.url));
    const bw = REPUTABLE_DOMAINS.indexOf(getDomain(b.url));
    return bw - aw;
}

export function computeWeightedSentiment(items, now = Date.now()) {
    let weightedSum = 0;
    let totalWeight = 0;

    for (const item of items) {
        if (!item) {
            continue;
        }
        const sentiment = clampSentiment(typeof item.sentiment === "number" ? item.sentiment : Number(item.sentiment));
        if (!Number.isFinite(sentiment)) {
            continue;
        }
        const publishedAt = item.publishedAt instanceof Date ? item.publishedAt : new Date(item.publishedAt);
        if (!(publishedAt instanceof Date) || Number.isNaN(publishedAt.getTime())) {
            continue;
        }
        const ageHours = Math.max(0, (now - publishedAt.getTime()) / (60 * 60 * 1000));
        const recencyWeight = Math.exp(-ageHours / 24);
        const domain = getDomain(item.url);
        const domainWeight = REPUTABLE_DOMAINS.includes(domain) ? 1.2 : 1;
        const weight = recencyWeight * domainWeight;
        if (!Number.isFinite(weight) || weight <= 0) {
            continue;
        }
        weightedSum += sentiment * weight;
        totalWeight += weight;
    }

    if (totalWeight <= 0) {
        return 0;
    }
    const avg = weightedSum / totalWeight;
    return clampSentiment(avg);
}

async function classifySentiments(items) {
    const titles = items.map(i => i.title);
    if (!titles.length) return [];
    const provider = (CFG.sentimentProvider || "tfjs").toLowerCase();
    const log = withContext(logger);

    if (provider === "api" && CFG.sentimentApiUrl) {
        try {
            const headers = { "content-type": "application/json" };
            if (CFG.sentimentApiKey) {
                headers.authorization = `Bearer ${CFG.sentimentApiKey}`;
            }
            const response = await axios.post(CFG.sentimentApiUrl, { inputs: titles }, { headers, timeout: 15000 });
            const data = response?.data;
            const arr = Array.isArray(data?.sentiments)
                ? data.sentiments
                : Array.isArray(data)
                    ? data
                    : Array.isArray(data?.scores)
                        ? data.scores
                        : null;
            if (Array.isArray(arr)) {
                const normalized = arr.map((value) => normalizeSentiment(value));
                if (normalized.some((value) => Number.isFinite(value))) {
                    return normalized.map(clampSentiment);
                }
            }
        } catch (err) {
            log.error({ fn: "classifySentiments", err }, "Sentiment classification via API failed");
        }
    }

    if (provider === "openrouter" && CFG.openrouterApiKey) {
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
                return arr.map((n) => clampSentiment(Number(n)));
            }
        } catch (err) {
            log.error({ fn: "classifySentiments", err }, "Sentiment classification via OpenRouter failed");
        }
    }

    try {
        const localScores = await classifySentimentsLocal(titles);
        if (Array.isArray(localScores) && localScores.length === titles.length) {
            return localScores.map((score) => clampSentiment(score));
        }
    } catch (err) {
        log.error({ fn: "classifySentiments", err }, "Local sentiment classification failed");
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
    const log = withContext(logger, { asset: symbol });
    log.info({ fn: "getAssetNews" }, `Fetching news for ${symbol}`);
    if (!symbol) {
        return { items: [], summary: "", avgSentiment: 0, weightedSentiment: 0 };
    }

    const now = Date.now();
    const cacheKey = getCacheKey(symbol, lookbackHours, limit);

    try {
        const cached = await getCachedNews(cacheKey, now, log);
        if (cached) {
            if (Array.isArray(cached.items) && cached.items.length && typeof cached.weightedSentiment !== "number") {
                const reconstructed = cached.items.map((item) => ({
                    ...item,
                    publishedAt: new Date(item.publishedAt),
                }));
                const computedWeighted = computeWeightedSentiment(reconstructed);
                if (Number.isFinite(computedWeighted)) {
                    cached.weightedSentiment = computedWeighted;
                }
            }
            return cached;
        }
    } catch (err) {
        log.warn({ fn: "getAssetNews", err }, "Failed to read news cache; continuing without cache");
    }

    try {
        const [serpItems, rssItems] = await Promise.all([
            fetchSerpApiNews({ symbol, lookbackHours, limit, log }),
            fetchRssNews({ symbol, lookbackHours, limit, log }),
        ]);

        let combined = [...serpItems, ...rssItems].filter((item) => item && item.title && item.url);

        if (!combined.length) {
            const emptyResult = { items: [], summary: "", avgSentiment: 0, weightedSentiment: 0 };
            await setCachedNews(cacheKey, emptyResult, now, log);
            return emptyResult;
        }

        let filtered = combined.filter((item) => REPUTABLE_DOMAINS.includes(getDomain(item.url)));
        if (filtered.length < 2) {
            filtered = combined;
        }

        filtered.sort(sortByRank);
        filtered = dedupeByTrigram(filtered);
        filtered = await filterFreshNewsItems(filtered, now, log);
        filtered = filtered.slice(0, limit);

        if (!filtered.length) {
            const emptyResult = { items: [], summary: "", avgSentiment: 0, weightedSentiment: 0 };
            await setCachedNews(cacheKey, emptyResult, now, log);
            return emptyResult;
        }

        const sentiments = await classifySentiments(filtered);
        const normalizedSentiments = filtered.map((_, idx) => clampSentiment(sentiments[idx] ?? 0));
        const avgSentiment = normalizedSentiments.length
            ? normalizedSentiments.reduce((a, b) => a + b, 0) / normalizedSentiments.length
            : 0;
        filtered = filtered.map((item, idx) => ({ ...item, sentiment: normalizedSentiments[idx] ?? 0 }));
        filtered = await translateNewsItems(filtered, log);
        const weightedSentiment = computeWeightedSentiment(filtered, now);

        let summary = "";
        if (CFG.openrouterApiKey && filtered.length) {
            try {
                const prompt = `Summarize in a couple sentences the following news about ${symbol}:\n` +
                    filtered.map((item) => `- ${item.title} (${item.source})`).join("\n");
                const messages = [
                    { role: "system", content: "You are a concise financial news assistant." },
                    { role: "user", content: [{ type: "text", text: prompt }] },
                ];
                summary = await callOpenRouter(messages);
            } catch (err) {
                log.warn({ fn: "getAssetNews", err }, "Failed to summarize news via OpenRouter");
            }
        }
        if (!summary) {
            summary = filtered.slice(0, 3).map((item) => `${item.source}: ${item.title}`).join(" | ");
        }

        await markNewsItemsAsSeen(filtered, now, log);

        const normalized = filtered.map((item) => ({
            ...item,
            publishedAt: item.publishedAt.toISOString(),
        }));

        const result = { items: normalized, summary: summary.trim(), avgSentiment: clampSentiment(avgSentiment), weightedSentiment };
        await setCachedNews(cacheKey, result, now, log);
        return result;
    } catch (error) {
        log.error({ fn: "getAssetNews", err: error }, "Error fetching asset news");
        return { items: [], summary: "", avgSentiment: 0, weightedSentiment: 0 };
    }
}
