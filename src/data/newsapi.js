import axios from "axios";
import { config } from "../config.js";
import { logger, withContext } from "../logger.js";
import { fetchWithRetry } from "../utils.js";

export async function searchNews(asset) {
    if (!config.newsApiKey) return [];
    const log = withContext(logger, { asset, fn: 'searchNews' });
    let attempt = 0;
    try {
        const { data } = await fetchWithRetry(async () => {
            attempt += 1;
            log.debug({ attempt }, 'Requesting headlines from NewsAPI');
            const response = await axios.get("https://newsapi.org/v2/everything", {
                params: {
                    q: asset,
                    language: "en",
                    sortBy: "publishedAt",
                    pageSize: 3,
                    apiKey: config.newsApiKey,
                },
            });
            const articleCount = Array.isArray(response?.data?.articles) ? response.data.articles.length : 0;
            log.info({ attempt, status: response?.status, articles: articleCount }, 'NewsAPI request succeeded');
            return response;
        });
        const articles = Array.isArray(data?.articles) ? data.articles : [];
        return articles.map(a => ({
            title: a.title,
            description: a.description || "",
        }));
    } catch (error) {
        log.error({ err: error }, 'Error fetching news');
        return [];
    }
}
