import { getJson } from "serpapi";


export const fetchNews = async (crypto_news_prompt) => {
    let res = await getJson({
        api_key: "84808d47951625a68603dcc0a0da939b2a2b36904527476422771daa63b952ed",
        engine: "google_news",
        q: crypto_news_prompt
    });
    return res;
};

export const searchWeb = async (crypto_search_prompt) => {
    let res = await getJson({
        api_key: "84808d47951625a68603dcc0a0da939b2a2b36904527476422771daa63b952ed",
        engine: "google",
        q: crypto_search_prompt,
        google_domain: "google.com",
        gl: "us",
        hl: "en"
    });
    return res;
};


export const fetchTrending = async (crypto_trending_prompt) => {

    let res = await getJson({
        api_key: "84808d47951625a68603dcc0a0da939b2a2b36904527476422771daa63b952ed",
        engine: "google_trends",
        q: crypto_trending_prompt,
        data_type: "TIMESERIES",
        include_low_search_volume: "true"
    }, (json) => {
        console.log(json);
    });

    return res;
};