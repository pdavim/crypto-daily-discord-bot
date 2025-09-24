import { CFG } from "../config.js";

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function last(series) {
    return Array.isArray(series) && series.length > 0 ? series[series.length - 1] : null;
}

function toFiniteNumber(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function computeSlope(series = [], lookback = 5) {
    if (!Array.isArray(series) || series.length < 2) {
        return 0;
    }
    const period = Number.isFinite(lookback) && lookback > 1 ? Math.trunc(lookback) : 5;
    const window = series.slice(-1 - period);
    if (window.length < 2) {
        return 0;
    }

    const first = toFiniteNumber(window[0]);
    const lastValue = toFiniteNumber(window[window.length - 1]);
    if (first === null || lastValue === null) {
        return 0;
    }
    if (first === 0) {
        return lastValue > 0 ? 1 : lastValue < 0 ? -1 : 0;
    }

    return (lastValue - first) / Math.abs(first);
}

function mergePostureConfig(overrides) {
    const base = isPlainObject(CFG.marketPosture) ? CFG.marketPosture : {};
    return {
        ...base,
        ...(isPlainObject(overrides) ? overrides : {}),
    };
}

export function evaluateMarketPosture({
    closes = [],
    maFastSeries = [],
    maSlowSeries = [],
    rsiSeries = [],
    adxSeries = [],
    config,
} = {}) {
    const cfg = mergePostureConfig(config);

    const price = toFiniteNumber(last(closes));
    const maFast = toFiniteNumber(last(maFastSeries));
    const maSlow = toFiniteNumber(last(maSlowSeries));
    const rsi = toFiniteNumber(last(rsiSeries));
    const adx = toFiniteNumber(last(adxSeries));
    const slope = computeSlope(closes, cfg.lookback);

    const ratio = maFast !== null && maSlow !== null && maSlow !== 0
        ? maFast / maSlow
        : null;

    const reasons = [];
    let bias = "neutral";
    let score = 0;
    let checks = 0;

    if (ratio !== null) {
        checks += 1;
        if (ratio >= cfg.bullishMaRatio) {
            bias = "bullish";
            score += 1;
            reasons.push("fast MA above slow MA threshold");
        } else if (ratio <= cfg.bearishMaRatio) {
            bias = "bearish";
            score += 1;
            reasons.push("fast MA below slow MA threshold");
        } else if (Math.abs(ratio - 1) <= cfg.neutralBuffer) {
            reasons.push("moving averages converging");
        }
    }

    if (Number.isFinite(slope) && slope !== 0) {
        checks += 1;
        if (slope >= cfg.minSlope) {
            if (bias !== "bearish") {
                bias = "bullish";
            }
            score += 1;
            reasons.push("positive momentum");
        } else if (slope <= -cfg.minSlope) {
            bias = "bearish";
            score += 1;
            reasons.push("negative momentum");
        }
    }

    if (rsi !== null) {
        checks += 1;
        if (rsi >= cfg.rsiBullish) {
            if (bias !== "bearish") {
                bias = "bullish";
            }
            score += 1;
            reasons.push("RSI in bullish zone");
        } else if (rsi <= cfg.rsiBearish) {
            bias = "bearish";
            score += 1;
            reasons.push("RSI in bearish zone");
        }
    }

    let trendStrong = false;
    if (adx !== null) {
        checks += 1;
        if (adx >= cfg.minTrendStrength) {
            trendStrong = true;
            score += 1;
            reasons.push("trend strength confirmed");
        } else {
            reasons.push("trend strength weak");
        }
    }

    let posture = bias;
    if (posture === "neutral" && slope !== 0) {
        if (slope > cfg.minSlope) {
            posture = "bullish";
        } else if (slope < -cfg.minSlope) {
            posture = "bearish";
        }
    }

    if (!trendStrong && posture !== "neutral") {
        reasons.push("trend strength below threshold");
    }

    const confidence = checks > 0 ? Math.min(1, score / checks) : 0;

    return {
        posture,
        confidence,
        reasons,
        metrics: {
            price,
            maFast,
            maSlow,
            ratio,
            slope,
            rsi,
            adx,
            trendStrong,
        },
    };
}

export function deriveStrategyFromPosture(result, strategyOverrides) {
    const strategyConfig = mergeStrategyConfig(strategyOverrides);
    const posture = result?.posture ?? "neutral";
    const confidence = Number.isFinite(result?.confidence) ? result.confidence : 0;
    const reasons = Array.isArray(result?.reasons) ? result.reasons.slice() : [];

    if (confidence < strategyConfig.minimumConfidence) {
        reasons.push(`confidence ${confidence.toFixed(2)} below ${strategyConfig.minimumConfidence}`);
        return {
            action: "flat",
            posture,
            confidence,
            reasons,
        };
    }

    const action = posture === "bullish"
        ? "long"
        : posture === "bearish"
            ? "short"
            : "flat";

    return {
        action,
        posture,
        confidence,
        reasons,
    };
}

function mergeStrategyConfig(overrides) {
    const base = isPlainObject(CFG.trading?.strategy) ? CFG.trading.strategy : {};
    const merged = {
        minimumConfidence: Number.isFinite(base.minimumConfidence) ? base.minimumConfidence : 0.35,
    };
    if (isPlainObject(overrides) && Number.isFinite(overrides.minimumConfidence)) {
        merged.minimumConfidence = overrides.minimumConfidence;
    }
    return merged;
}

export function computeSlopePercent(series, lookback) {
    return computeSlope(series, lookback);
}
