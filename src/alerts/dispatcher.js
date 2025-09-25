import { ASSETS } from "../assets.js";

const queue = [];

/**
 * Builds a lookup map with optional market cap ranks for configured assets so
 * dispatch ordering can prioritise the most relevant markets before falling
 * back to alphabetical sorting.
 */
const assetMetadata = (() => {
    const metadata = new Map();
    for (const asset of ASSETS) {
        if (!asset || typeof asset.key !== "string") {
            continue;
        }
        const normalizedKey = asset.key;
        const rank = Number.isFinite(asset.marketCapRank) ? asset.marketCapRank : null;
        metadata.set(normalizedKey, {
            key: normalizedKey,
            rank,
        });
    }
    return metadata;
})();

/**
 * Compares two asset identifiers, preferring their market cap ranking when
 * available and gracefully degrading to an alphabetical comparison. Unknown
 * assets (for example, synthetic or ad-hoc tickers) are also sorted
 * alphabetically to keep the dispatch flow deterministic.
 */
function compareAssets(assetA, assetB) {
    const keyA = typeof assetA === "string" ? assetA : "";
    const keyB = typeof assetB === "string" ? assetB : "";
    const metaA = assetMetadata.get(keyA);
    const metaB = assetMetadata.get(keyB);

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
    queue.push(payload);
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
