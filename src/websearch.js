import axios from "axios";
import { config } from "./config.js";

export const WEB_SNIPPETS = [];

const BLOG_SOURCES = {
    BTC: "https://bitcoin.org/en/blog",
    ETH: "https://blog.ethereum.org",
    SOL: "https://solana.com/news",
    TRX: "https://blog.tron.network",
    POL: "https://polygon.technology/blog",
    SUI: "https://blog.sui.io"
};

function stripHtml(html) {
    return html.replace(/<[^>]+>/g, "").trim();
}

async function fetchOfficialBlog(asset) {
    const url = BLOG_SOURCES[asset];
    if (!url) return null;
    try {
        const { data } = await axios.get(url);
        const match = data.match(/<h[12][^>]*>\s*<a[^>]*>(.*?)<\/a>/i);
        if (match) {
            return `Official ${asset} blog: ${stripHtml(match[1])}`;
        }
    } catch (err) {
        console.error(`Error fetching official blog for ${asset}:`, err.message);
    }
    return null;
}

export async function searchWeb(asset) {
    WEB_SNIPPETS.length = 0;
    if (!config.serpapiApiKey || !asset) {
        return WEB_SNIPPETS;
    }
    try {
        const params = {
            engine: "google",
            q: `what's happening with ${asset} today`,
            api_key: config.serpapiApiKey,
            num: 5,
        };
        const { data } = await axios.get("https://serpapi.com/search", { params });
        const results = data.organic_results || [];
        results.slice(0, 5).forEach(r => {
            if (r.snippet) {
                WEB_SNIPPETS.push(r.snippet);
            }
        });
    } catch (err) {
        console.error("Error fetching web results:", err.message);
    }
    const official = await fetchOfficialBlog(asset);
    if (official) {
        WEB_SNIPPETS.unshift(official);
    }
    return WEB_SNIPPETS;
}
