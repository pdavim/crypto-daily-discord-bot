import { CFG } from "../config.js";

const queue = [];

/**
 * Builds a lookup map with optional market cap ranks for configured assets so
 * dispatch ordering can prioritise the most relevant markets before falling
 * back to alphabetical sorting.
 */
function getAssetMetadata(key) {
    if (!key) {
        return { key: null, rank: null };
    }
    const map = CFG.assetMap;
    const normalizedKey = key.toUpperCase?.() ?? key;
    const asset = map && typeof map.get === 'function'
        ? map.get(normalizedKey)
        : null;
    if (asset) {
        const rank = Number.isFinite(asset.marketCapRank) ? asset.marketCapRank : null;
        return { key: asset.key, rank };
    }
    const assets = Array.isArray(CFG.assets) ? CFG.assets : [];
    const fallback = assets.find(item => item.key === normalizedKey);
    if (fallback) {
        const rank = Number.isFinite(fallback.marketCapRank) ? fallback.marketCapRank : null;
        return { key: fallback.key, rank };
    }
    return { key: normalizedKey, rank: null };
}

/**
 * Compares two asset identifiers, preferring their market cap ranking when
 * available and gracefully degrading to an alphabetical comparison. Unknown
 * assets (for example, synthetic or ad-hoc tickers) are also sorted
 * alphabetically to keep the dispatch flow deterministic.
 */
function compareAssets(assetA, assetB) {
    const keyA = typeof assetA === "string" ? assetA : "";
    const keyB = typeof assetB === "string" ? assetB : "";
    const metaA = getAssetMetadata(keyA);
    const metaB = getAssetMetadata(keyB);

    const rankA = metaA?.rank;
    const rankB = metaB?.rank;
    if (Number.isFinite(rankA) && Number.isFinite(rankB) && rankA !== rankB) {
        return rankA - rankB;
    }
    if (Number.isFinite(rankA) && !Number.isFinite(rankB)) {
        return -1;
    }
    if (!Number.isFinite(rankA) && Number.isFinite(rankB)) {
        return 1;
    }
    const labelA = metaA?.key ?? keyA;
    const labelB = metaB?.key ?? keyB;
    return labelA.localeCompare(labelB);
}

function timeframeRank(orderMap, timeframe) {
    if (!timeframe || !orderMap.has(timeframe)) {
        return Number.MAX_SAFE_INTEGER;
    }
    return orderMap.get(timeframe);
}

export function enqueueAlertPayload(payload) {
    if (!payload || !payload.message) {
        return;
    }
    const messageType = typeof payload.messageType === "string" && payload.messageType.trim() !== ""
        ? payload.messageType.trim()
        : undefined;
    const metadata = payload.metadata && typeof payload.metadata === "object"
        ? payload.metadata
        : undefined;

    queue.push({
        ...payload,
        ...(messageType ? { messageType } : {}),
        ...(metadata ? { metadata } : {}),
    });
}

export async function flushAlertQueue({ sender, timeframeOrder = [] } = {}) {
    if (queue.length === 0) {
        return;
    }

    const orderMap = new Map(timeframeOrder.map((tf, index) => [tf, index]));
    const handler = typeof sender === "function" ? sender : async () => {};

    queue.sort((a, b) => {
        const assetCompare = compareAssets(a.asset, b.asset);
        if (assetCompare !== 0) {
            return assetCompare;
        }
        const rankA = timeframeRank(orderMap, a.timeframe);
        const rankB = timeframeRank(orderMap, b.timeframe);
        if (rankA !== rankB) {
            return rankA - rankB;
        }
        return 0;
    });

    for (const payload of queue) {
        await handler(payload);
    }

    queue.length = 0;
}

export function clearAlertQueue() {
    queue.length = 0;
}

export function getQueuedAlerts() {
    return [...queue];
}
