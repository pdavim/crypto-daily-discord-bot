export const HIGHER_TIMEFRAME_METRICS = Object.freeze(["24h", "7d", "30d"]);
const KPI_KEY_BY_LABEL = Object.freeze({
    "24h": "var24h",
    "7d": "var7d",
    "30d": "var30d"
});

/**
 * @typedef {Object} TimeframeSnapshot
 * @property {Object.<string, number>} [kpis]
 */

/** @typedef {Object.<string, TimeframeSnapshot>} SnapshotMap */


function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
}

function addMetric(target, label, value) {
    if (!label || Object.prototype.hasOwnProperty.call(target, label)) {
        return;
    }
    if (!isFiniteNumber(value)) {
        return;
    }
    target[label] = value;
}

function resolveAnchorSnapshot(snapshots) {
    if (snapshots?.["4h"]) {
        return snapshots["4h"];
    }
    if (snapshots?.["1h"]) {
        return snapshots["1h"];
    }
    const firstEntry = Object.values(snapshots ?? {}).find(Boolean);
    return firstEntry ?? null;
}

/**
 * Consolidates price variation metrics extracted from timeframe snapshots.
 * @param {Object} params - Parameters for metric extraction.
 * @param {SnapshotMap} params.snapshots - KPI snapshots keyed by timeframe.
 * @returns {Record<string, number>} Map with variation values per timeframe or horizon.
 */
export function collectVariationMetrics({ snapshots = {} } = {}) {
    const metrics = {};

    for (const [timeframe, snapshot] of Object.entries(snapshots)) {
        addMetric(metrics, timeframe, snapshot?.kpis?.var);
    }

    const anchorSnapshot = resolveAnchorSnapshot(snapshots);
    const anchorKpis = anchorSnapshot?.kpis ?? null;
    if (anchorKpis) {
        for (const label of HIGHER_TIMEFRAME_METRICS) {
            const kpiKey = KPI_KEY_BY_LABEL[label];
            addMetric(metrics, label, anchorKpis?.[kpiKey]);
        }
    }

    return metrics;
}

export const __private__ = {
    HIGHER_TIMEFRAME_METRICS,
    isFiniteNumber,
    addMetric,
    resolveAnchorSnapshot,
    KPI_KEY_BY_LABEL
};

