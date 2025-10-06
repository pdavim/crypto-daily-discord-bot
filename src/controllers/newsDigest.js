import { ASSETS } from "../assets.js";
import { CFG } from "../config.js";
import { logger, withContext } from "../logger.js";
import { getAssetNews } from "../news.js";
import { postNewsDigest } from "../discord.js";
import { recordNewsDigest } from "./sheetsReporter.js";

const DEFAULT_LOOKBACK_HOURS = 24;
const DEFAULT_HEADLINE_LIMIT = 3;
const DEFAULT_SUMMARY_FALLBACK = "No significant headlines across tracked assets.";

const SENTIMENT_EMOJI = {
    bullish: "🟢",
    neutral: "🟡",
    bearish: "🔴",
};

function resolveSentimentBucket(score) {
    if (!Number.isFinite(score)) {
        return "neutral";
    }
    if (score >= 0.25) {
        return "bullish";
    }
    if (score <= -0.25) {
        return "bearish";
    }
    return "neutral";
}

function formatSentimentLabel(score) {
    const bucket = resolveSentimentBucket(score);
    const rounded = Number.isFinite(score) ? score.toFixed(2) : "0.00";
    if (bucket === "bullish") {
        return `Bullish (${rounded})`;
    }
    if (bucket === "bearish") {
        return `Bearish (${rounded})`;
    }
    return `Neutral (${rounded})`;
}

function emojiForSentiment(score) {
    const bucket = resolveSentimentBucket(score);
    return SENTIMENT_EMOJI[bucket] ?? SENTIMENT_EMOJI.neutral;
}

function sanitizeHeadline(headline) {
    if (!headline || typeof headline !== "object") {
        return null;
    }
    const title = typeof headline.title === "string" ? headline.title.trim() : "";
    const url = typeof headline.url === "string" ? headline.url.trim() : "";
    if (!title || !url) {
        return null;
    }
    const source = typeof headline.source === "string" ? headline.source.trim() : "";
    const sentiment = Number.isFinite(headline.sentiment) ? headline.sentiment : 0;
    return {
        title,
        url,
        source,
        sentiment,
    };
}

function buildFallbackSummary(assetKey, headlines) {
    if (!Array.isArray(headlines) || headlines.length === 0) {
        return `${assetKey}: No significant headlines in the last day.`;
    }
    const titles = headlines.slice(0, 2).map((item) => item.title);
    return `${assetKey}: ${titles.join(" | ")}`;
}

export async function buildNewsDigest({
    lookbackHours = DEFAULT_LOOKBACK_HOURS,
    perAssetLimit = DEFAULT_HEADLINE_LIMIT,
} = {}) {
    const log = withContext(logger, { fn: "buildNewsDigest" });
    const now = new Date();
    const assetResults = await Promise.all(
        ASSETS.map(async ({ key }) => {
            const assetLog = withContext(log, { asset: key });
            try {
                const { items = [], summary = "", weightedSentiment = 0, avgSentiment = 0 } = await getAssetNews({
                    symbol: key,
                    lookbackHours,
                    limit: perAssetLimit,
                });
                const headlines = items
                    .map((item) => sanitizeHeadline(item))
                    .filter(Boolean)
                    .slice(0, perAssetLimit);
                const cleanedSummary = typeof summary === "string" ? summary.trim() : "";
                return {
                    asset: key,
                    summary: cleanedSummary,
                    weightedSentiment: Number.isFinite(weightedSentiment) ? weightedSentiment : 0,
                    avgSentiment: Number.isFinite(avgSentiment) ? avgSentiment : 0,
                    headlines,
                };
            } catch (error) {
                assetLog.warn({ err: error }, 'Failed to build news digest section for asset');
                return {
                    asset: key,
                    summary: "",
                    weightedSentiment: 0,
                    avgSentiment: 0,
                    headlines: [],
                };
            }
        }),
    );

    const sections = [];
    const summaryParts = [];
    const topHeadlines = [];

    for (const result of assetResults) {
        const { asset, summary, headlines, weightedSentiment } = result;
        const sentimentLabel = formatSentimentLabel(weightedSentiment);
        const header = `**${asset}** — ${sentimentLabel}`;
        const lines = [header];
        const effectiveSummary = summary || buildFallbackSummary(asset, headlines);
        lines.push(`_${effectiveSummary}_`);
        summaryParts.push(`${asset}: ${effectiveSummary}`);

        for (const headline of headlines) {
            const emoji = emojiForSentiment(headline.sentiment);
            const sentimentText = formatSentimentLabel(headline.sentiment);
            const sourceText = headline.source ? ` — ${headline.source}` : "";
            lines.push(`• ${emoji} [${headline.title}](${headline.url})${sourceText} (${sentimentText})`);
        }

        if (headlines[0]) {
            topHeadlines.push({ asset, ...headlines[0] });
        }

        sections.push(lines.join("\n"));
    }

    const hasContent = sections.some((section) => section.trim() !== "");
    const summaryText = summaryParts.length > 0
        ? summaryParts.join(" | ")
        : DEFAULT_SUMMARY_FALLBACK;

    const content = hasContent
        ? [`**🗞️ Daily Crypto News Digest**`, ...sections].join("\n\n")
        : `**🗞️ Daily Crypto News Digest**\n${DEFAULT_SUMMARY_FALLBACK}`;

    return {
        generatedAt: now,
        content,
        summary: summaryText,
        topHeadlines,
        sentiments: assetResults.map(({ asset, weightedSentiment, avgSentiment }) => ({
            asset,
            weightedSentiment,
            avgSentiment,
        })),
        assets: assetResults,
    };
}

export async function dispatchNewsDigest({
    lookbackHours = DEFAULT_LOOKBACK_HOURS,
    perAssetLimit = DEFAULT_HEADLINE_LIMIT,
} = {}) {
    const log = withContext(logger, { fn: "dispatchNewsDigest" });
    const digest = await buildNewsDigest({ lookbackHours, perAssetLimit });

    if (!digest || typeof digest.content !== "string" || digest.content.trim() === "") {
        log.info('Skipping news digest; no content generated');
        return { digest, delivery: { delivered: false, webhookUrl: null, channelId: CFG?.newsDigest?.channelId ?? null } };
    }

    const webhookUrl = CFG?.newsDigest?.webhookUrl ?? null;
    const configuredChannelId = CFG?.newsDigest?.channelId ?? null;

    const delivery = await postNewsDigest({
        content: digest.content,
        webhookUrl,
        channelId: configuredChannelId ?? undefined,
    });

    const resolvedChannelId = delivery?.channelId ?? configuredChannelId ?? null;
    const resolvedWebhookUrl = delivery?.webhookUrl ?? webhookUrl ?? null;

    const sheetMapKey = CFG?.newsDigest?.sheetMapKey ?? "newsDigest";
    const sheetFallback = CFG?.newsDigest?.sheetFallback ?? "news_digest";

    recordNewsDigest({
        summary: digest.summary,
        topHeadlines: digest.topHeadlines,
        sentiment: digest.sentiments,
        assets: digest.assets,
        webhookKey: sheetMapKey,
        channelId: resolvedChannelId ?? undefined,
        webhookUrl: resolvedWebhookUrl ?? undefined,
        fallbackSheet: sheetFallback,
        timestamp: digest.generatedAt,
    });

    if (delivery?.delivered) {
        log.info({ channelId: resolvedChannelId }, 'Posted news digest to Discord');
    } else {
        log.warn({ channelId: resolvedChannelId }, 'News digest delivery skipped or failed');
    }

    return { digest, delivery };
}
