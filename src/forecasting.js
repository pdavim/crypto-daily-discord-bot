import fs from "node:fs";
import path from "node:path";
import { logger, withContext } from "./logger.js";

const clamp01 = (value) => {
    if (!Number.isFinite(value)) {
        return 0;
    }
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
};

const toNumber = (value) => {
    if (value instanceof Date) {
        const ms = value.getTime();
        return Number.isFinite(ms) ? ms : null;
    }
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === "string") {
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
};

const ensureDirectory = (dirPath) => {
    if (!dirPath) {
        return;
    }
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
};

const regressionFromSeries = (xs, ys) => {
    const n = Math.min(xs.length, ys.length);
    if (n < 2) {
        return null;
    }
    const xValues = xs.slice(xs.length - n);
    const yValues = ys.slice(ys.length - n);

    const meanX = xValues.reduce((sum, x) => sum + x, 0) / n;
    const meanY = yValues.reduce((sum, y) => sum + y, 0) / n;

    let cov = 0;
    let varX = 0;
    for (let i = 0; i < n; i += 1) {
        const dx = xValues[i] - meanX;
        cov += dx * (yValues[i] - meanY);
        varX += dx * dx;
    }
    if (varX === 0) {
        return null;
    }
    const slope = cov / varX;
    const intercept = meanY - slope * meanX;
    let residualSS = 0;
    let totalSS = 0;
    let absError = 0;
    for (let i = 0; i < n; i += 1) {
        const predicted = intercept + slope * xValues[i];
        const diff = yValues[i] - predicted;
        residualSS += diff * diff;
        totalSS += (yValues[i] - meanY) * (yValues[i] - meanY);
        absError += Math.abs(diff);
    }
    const rSquared = totalSS === 0 ? 1 : 1 - (residualSS / totalSS);
    const mae = absError / n;
    const rmse = Math.sqrt(residualSS / n);
    let step = 0;
    for (let i = 1; i < n; i += 1) {
        const diff = xValues[i] - xValues[i - 1];
        if (Number.isFinite(diff) && diff > 0) {
            step += diff;
        }
    }
    if (step > 0) {
        step /= (n - 1);
    } else if (n >= 2) {
        const lastDiff = xValues[n - 1] - xValues[n - 2];
        step = Number.isFinite(lastDiff) && lastDiff !== 0 ? Math.abs(lastDiff) : 1;
    } else {
        step = 1;
    }

    const nextX = xValues[n - 1] + step;
    const forecast = intercept + slope * nextX;

    return {
        slope,
        intercept,
        rSquared,
        mae,
        rmse,
        nextX,
        step,
        sampleCount: n,
        lastX: xValues[n - 1],
        lastY: yValues[n - 1],
        forecast,
    };
};

/**
 * Computes a next-close forecast using linear regression over the latest samples.
 * @param {object} params - Forecast parameters.
 * @param {number[]} params.closes - Close price series ordered ascending by time.
 * @param {Array<number|Date|string>} [params.timestamps] - Optional timestamps aligned with closes.
 * @param {number} [params.lookback=48] - Preferred number of samples to regress against.
 * @param {number} [params.minHistory=72] - Minimum number of history samples required.
 * @returns {object|null} Forecast payload or null when prediction cannot be produced.
 */
export function forecastNextClose({ closes, timestamps = [], lookback = 48, minHistory = 72 } = {}) {
    if (!Array.isArray(closes) || closes.length < Math.max(2, minHistory)) {
        return null;
    }
    const historySize = Math.max(lookback, minHistory);
    const startIndex = Math.max(0, closes.length - historySize);
    const closeSlice = closes.slice(startIndex);

    const timestampSlice = Array.isArray(timestamps) && timestamps.length === closes.length
        ? timestamps.slice(startIndex).map(toNumber)
        : closeSlice.map((_, idx) => idx);

    if (!timestampSlice.every(Number.isFinite)) {
        return null;
    }

    const regression = regressionFromSeries(timestampSlice, closeSlice);
    if (!regression) {
        return null;
    }

    const confidence = clamp01(regression.rSquared);
    const delta = regression.forecast - regression.lastY;
    return {
        method: "linear-regression",
        forecast: regression.forecast,
        confidence,
        delta,
        slope: regression.slope,
        intercept: regression.intercept,
        samples: regression.sampleCount,
        mae: regression.mae,
        rmse: regression.rmse,
        lastClose: regression.lastY,
        lastTime: regression.lastX,
        nextTime: regression.nextX,
        horizonMs: regression.step,
    };
}

/**
 * Persists the forecast entry to disk, trimming history to the configured limit.
 * @param {object} params - Persistence parameters.
 * @param {string} params.assetKey - Asset identifier.
 * @param {string} params.timeframe - Timeframe key.
 * @param {object} params.entry - Forecast payload to persist.
 * @param {string} params.directory - Directory to store forecast files.
 * @param {number} [params.historyLimit=240] - Maximum number of entries to retain.
 * @returns {string|null} Absolute path to the written file or null when skipped.
 */
export function persistForecastEntry({
    assetKey,
    timeframe,
    entry,
    directory,
    historyLimit = 240,
}) {
    if (!assetKey || !timeframe || !entry || !directory) {
        return null;
    }
    const log = withContext(logger, { asset: assetKey, timeframe, fn: "persistForecastEntry" });
    try {
        ensureDirectory(directory);
        const assetDir = path.join(directory, assetKey);
        ensureDirectory(assetDir);
        const filePath = path.join(assetDir, `${timeframe}.json`);
        let history = [];
        if (fs.existsSync(filePath)) {
            try {
                const raw = fs.readFileSync(filePath, "utf-8");
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    history = parsed;
                }
            } catch (err) {
                log.warn({ err }, "Failed to read existing forecast history; resetting file.");
                history = [];
            }
        }
        history.push(entry);
        if (Number.isFinite(historyLimit) && historyLimit > 0 && history.length > historyLimit) {
            history = history.slice(-historyLimit);
        }
        fs.writeFileSync(filePath, `${JSON.stringify(history, null, 2)}\n`);
        return filePath;
    } catch (err) {
        log.error({ err }, "Failed to persist forecast");
        return null;
    }
}

