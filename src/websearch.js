import axios from "axios";
import { config } from "./config.js";
import { fetchWithRetry } from "./utils.js";
import { logger, withContext } from "./logger.js";

export const WEB_SNIPPETS = [];

const BLOG_SOURCES = {
    BTC: "https://bitcoin.org/en/blog",
    ETH: "https://blog.ethereum.org",
    SOL: "https://solana.com/news",
    TRX: "https://medium.com/tron-foundation",
    POL: "https://polygon.technology/blog",
    SUI: "https://blog.sui.io"
};

function stripHtml(html) {
    return html.replace(/<[^>]+>/g, "").trim();
}

async function fetchOfficialBlog(asset) {
    const log = withContext(logger, { asset });
    log.info({ fn: 'fetchOfficialBlog' }, `Fetching official blog for ${asset}`);
    const url = BLOG_SOURCES[asset];
    if (!url) return null;
    try {
        const { data } = await fetchWithRetry(() => axios.get(url));
        const match = data.match(/<h[12][^>]*>\s*<a[^>]*>(.*?)<\/a>/i);
        if (match) {
            return `Official ${asset} blog: ${stripHtml(match[1])}`;
        }
    } catch (err) {
        if (err.code === "ENOTFOUND" || err.code === "EAI_AGAIN") {
            return null;
        }
        log.error({ fn: 'fetchOfficialBlog', err }, `Error fetching official blog for ${asset}`);
    }
    return null;
}

/**
 * Retrieves recent web snippets and official blog updates for an asset.
 * @param {string} asset - Asset symbol to search for.
 * @returns {Promise} Snippets describing recent events.
 */
export async function searchWeb(asset) {
    const log = withContext(logger, { asset });
    log.info({ fn: 'searchWeb' }, `Fetching web results for ${asset}`);
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
        const { data } = await fetchWithRetry(() => axios.get("https://serpapi.com/search", { params }));
        log.info({ fn: 'searchWeb', data }, "Web search data");
        const results = data.organic_results || [];
        results.slice(0, 5).forEach(r => {
            if (r.snippet) {
                WEB_SNIPPETS.push(r.snippet);
            }
        });
    } catch (err) {
        log.error({ fn: 'searchWeb', err }, "Error fetching web results");
    }
    let official = null;
    try {
        official = await fetchOfficialBlog(asset);
    } catch (err) {
        if (err.code !== "ENOTFOUND" && err.code !== "EAI_AGAIN") {
            log.error({ fn: 'searchWeb', err }, `Error fetching official blog for ${asset}`);
        }
    }
    if (official) {
        WEB_SNIPPETS.unshift(official);
    }
    return WEB_SNIPPETS;
}
