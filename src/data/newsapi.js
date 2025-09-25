import axios from "axios";
import { config } from "../config.js";
import { logger, withContext } from "../logger.js";

export async function searchNews(asset) {
    if (!config.newsApiKey) return [];
    const log = withContext(logger, { asset });
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
        log.error({ fn: 'searchNews', err: error }, 'Error fetching news');
        return [];
    }
}
