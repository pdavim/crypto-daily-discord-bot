const queue = [];

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
        const assetA = a.asset ?? "";
        const assetB = b.asset ?? "";
        const assetCompare = assetA.localeCompare(assetB);
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
