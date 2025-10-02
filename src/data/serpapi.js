import { getJson } from "serpapi";
import { config } from "../config.js";
import { logger, withContext } from "../logger.js";
import { fetchWithRetry } from "../utils.js";

const apiKey = config.serpapiApiKey;
if (!apiKey) {
    throw new Error("SERPAPI_API_KEY environment variable is missing.");
}

export const fetchNews = async (crypto_news_prompt) => {
    const log = withContext(logger, { fn: 'fetchNews' });
    let attempt = 0;
    return fetchWithRetry(async () => {
        attempt += 1;
        log.debug({ attempt }, 'Requesting SerpAPI google_news results');
        const res = await getJson({
            api_key: apiKey,
            engine: "google_news",
            q: crypto_news_prompt
        });
        const results = Array.isArray(res?.news_results) ? res.news_results.length : 0;
        log.info({ attempt, results }, 'SerpAPI google_news request succeeded');
        return res;
    });
};

export const searchWeb = async (crypto_search_prompt) => {
    const log = withContext(logger, { fn: 'searchWeb' });
    let attempt = 0;
    return fetchWithRetry(async () => {
        attempt += 1;
        log.debug({ attempt }, 'Requesting SerpAPI google search results');
        const res = await getJson({
            api_key: apiKey,
            engine: "google",
            q: crypto_search_prompt,
            google_domain: "google.com",
            gl: "us",
            hl: "en",
        });
        const results = Array.isArray(res?.organic_results) ? res.organic_results.length : 0;
        log.info({ attempt, results }, 'SerpAPI google search request succeeded');
        return res;
    });
};

export const fetchTrending = async (crypto_trending_prompt) => {
    const log = withContext(logger, { fn: 'fetchTrending' });
    let attempt = 0;
    return fetchWithRetry(async () => {
        attempt += 1;
        log.debug({ attempt }, 'Requesting SerpAPI google_trends results');
        const res = await getJson({
            api_key: apiKey,
            engine: "google_trends",
            q: crypto_trending_prompt,
            data_type: "TIMESERIES",
            include_low_search_volume: "true",
        }, (json) => {
            log.info({ attempt, preview: json }, 'Received intermediate SerpAPI trends payload');
        });
        const series = Array.isArray(res?.interest_over_time?.timeline_data) ? res.interest_over_time.timeline_data.length : 0;
        log.info({ attempt, series }, 'SerpAPI google_trends request succeeded');
        return res;
    });
};

