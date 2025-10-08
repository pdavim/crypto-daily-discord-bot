import { getAssetNews } from "../news.js";
import { searchWeb } from "../websearch.js";
import { logger, withContext } from "../logger.js";

export function calcReturn(closes, days) {
    const last = closes.at(-1);
    const prev = closes.at(-(days + 1));
    if (!last || !prev) {
        return 0;
    }
    return ((last - prev) / prev) * 100;
}

export function fallbackVerdict({ ma20, ma50, rsi14 }) {
    if (ma20 > ma50 && rsi14 > 55) {
        return "📈 Uptrend with bullish momentum.";
    }
    if (ma20 < ma50 && rsi14 < 45) {
        return "📉 Downtrend with weak momentum.";
    }
    return "🔁 Mixed technical signals, hold.";
}

export async function getMacroContext() {
    const log = withContext(logger, { fn: "getMacroContext" });
    log.info({ fn: "getMacroContext" }, 'Fetching macro context...');
    try {
        const { summary } = await getAssetNews({ symbol: "crypto market" });
        const web = await searchWeb("crypto market");
        return [summary, web.slice(0, 2).join(" | ")].filter(Boolean).join(" | ");
    } catch (error) {
        log.warn({ fn: "getMacroContext", err: error }, 'Failed to fetch macro context');
        return "";
    }
}
