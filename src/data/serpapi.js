import { getJson } from "serpapi";
import { config } from "../config.js";

const apiKey = config.serpapiApiKey;
if (!apiKey) {
    throw new Error("SERPAPI_API_KEY environment variable is missing.");
}

export const fetchNews = async (crypto_news_prompt) => {
    const res = await getJson({
        api_key: apiKey,
        engine: "google_news",
        q: crypto_news_prompt
    });
    return res;
};

export const searchWeb = async (crypto_search_prompt) => {
    const res = await getJson({
        api_key: apiKey,
        engine: "google",
        q: crypto_search_prompt,
        google_domain: "google.com",
        gl: "us",
        hl: "en",
    });
    return res;
};

export const fetchTrending = async (crypto_trending_prompt) => {
    const res = await getJson({
        api_key: apiKey,
        engine: "google_trends",
        q: crypto_trending_prompt,
        data_type: "TIMESERIES",
        include_low_search_volume: "true",
    }, (json) => {
        console.log(json);
    });

    return res;
};

