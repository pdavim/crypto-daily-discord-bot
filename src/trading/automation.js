import { CFG } from "../config.js";
import { logger, withContext } from "../logger.js";
import { getMarginPositionRisk } from "./binance.js";
import { openPosition, closePosition } from "./executor.js";
import { reportTradingDecision } from "./notifier.js";

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toFinite(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function getTradingConfig() {
    return isPlainObject(CFG.trading) ? CFG.trading : {};
}

function getAutomationConfig() {
    const tradingCfg = getTradingConfig();
    const base = isPlainObject(tradingCfg.automation) ? tradingCfg.automation : {};
    return {
        enabled: Boolean(base.enabled),
        timeframe: typeof base.timeframe === "string" && base.timeframe.length > 0 ? base.timeframe : "4h",
        minConfidence: toFinite(base.minConfidence) ?? 0.55,
        positionPct: toFinite(base.positionPct) ?? 0.05,
        maxPositions: Number.isInteger(base.maxPositions) && base.maxPositions > 0 ? base.maxPositions : 3,
        positionEpsilon: toFinite(base.positionEpsilon) ?? 0.0001,
        mode: typeof base.mode === "string" ? base.mode : "margin",
    };
}

function mapDecisionToDirection(decision) {
    if (!decision) {
        return "flat";
    }
    const normalized = decision.toLowerCase();
    if (normalized === "buy") {
        return "long";
    }
    if (normalized === "sell") {
        return "short";
    }
    return "flat";
}

function extractConfidence({ strategy, posture, decision }) {
    const candidates = [strategy?.confidence, decision?.confidence, posture?.confidence];
    for (const value of candidates) {
        const parsed = toFinite(value);
        if (parsed !== null) {
            return parsed;
        }
    }
    return null;
}

function filterActivePositions(positions, epsilon) {
    if (!Array.isArray(positions)) {
        return [];
    }
    return positions.filter(position => {
        const qty = toFinite(position?.positionAmt);
        return qty !== null && Math.abs(qty) > epsilon;
    });
}

function normalizeSymbol(symbol) {
    return typeof symbol === "string" ? symbol.toUpperCase() : null;
}

function findPositionForSymbol(positions, symbol, epsilon) {
    const normalized = normalizeSymbol(symbol);
    if (!normalized) {
        return null;
    }
    return positions.find(position => normalizeSymbol(position?.symbol) === normalized && Math.abs(toFinite(position?.positionAmt) ?? 0) > epsilon) ?? null;
}

function computeQuantity({ price, positionPct }) {
    const equity = toFinite(CFG.accountEquity);
    const pct = toFinite(positionPct);
    if (equity === null || equity <= 0 || pct === null || pct <= 0) {
        return null;
    }
    const referencePrice = toFinite(price);
    if (referencePrice === null || referencePrice <= 0) {
        return null;
    }
    const notional = equity * pct;
    const quantity = notional / referencePrice;
    return quantity > 0 ? quantity : null;
}

function derivePositionDirection(positionAmt, epsilon) {
    const qty = toFinite(positionAmt);
    if (qty === null || Math.abs(qty) <= epsilon) {
        return "flat";
    }
    return qty > 0 ? "long" : "short";
}

export async function automateTrading({
    assetKey,
    symbol,
    timeframe,
    decision,
    posture,
    strategy,
    snapshot,
} = {}) {
    const tradingCfg = getTradingConfig();
    const automationCfg = getAutomationConfig();
    const log = withContext(logger, { asset: assetKey ?? symbol, action: "automateTrading" });

    const baseDirection = mapDecisionToDirection(decision?.decision ?? decision);
    const baseConfidence = extractConfidence({ strategy, posture, decision });

    const emitDecision = async (event) => {
        try {
            await reportTradingDecision({
                assetKey,
                symbol,
                timeframe,
                status: event.status,
                action: event.action,
                direction: event.direction ?? baseDirection,
                reason: event.reason,
                confidence: event.confidence ?? baseConfidence,
                quantity: event.quantity,
                metadata: event.metadata,
                timestamp: event.timestamp,
            });
        } catch (error) {
            log.error({ fn: "automateTrading", err: error }, "Failed to report trading decision");
        }
    };

    if (!tradingCfg.enabled || !automationCfg.enabled) {
        await emitDecision({ status: "skipped", reason: "disabled" });
        return { skipped: true, reason: "disabled" };
    }

    if (typeof symbol !== "string" || symbol.length === 0) {
        await emitDecision({ status: "skipped", reason: "missingSymbol" });
        return { skipped: true, reason: "missingSymbol" };
    }

    if (timeframe !== automationCfg.timeframe) {
        await emitDecision({ status: "skipped", reason: "timeframeMismatch", metadata: { timeframe } });
        return { skipped: true, reason: "timeframeMismatch" };
    }

    const direction = baseDirection;
    const confidence = baseConfidence;

    if (direction !== "flat" && confidence !== null && confidence < automationCfg.minConfidence) {
        log.debug({ fn: "automateTrading", confidence }, 'Skipped trade due to low confidence');
        await emitDecision({
            status: "skipped",
            reason: "lowConfidence",
            confidence,
            metadata: { minConfidence: automationCfg.minConfidence },
        });
        return { skipped: true, reason: "lowConfidence", confidence };
    }

    if (direction === "flat") {
        const positions = filterActivePositions(await getMarginPositionRisk({ symbol }), automationCfg.positionEpsilon);
        const existing = findPositionForSymbol(positions, symbol, automationCfg.positionEpsilon);
        if (!existing) {
            await emitDecision({ status: "skipped", reason: "noPosition", direction: "flat" });
            return { skipped: true, reason: "noPosition" };
        }
        const existingDirection = derivePositionDirection(existing.positionAmt, automationCfg.positionEpsilon);
        try {
            await closePosition({
                symbol,
                assetKey,
                direction: existingDirection,
                quantity: Math.abs(existing.positionAmt),
                metadata: { referencePrice: snapshot?.kpis?.price },
            });
            log.info({ fn: "automateTrading", direction: existingDirection }, 'Closed position after flat signal');
            await emitDecision({
                status: "executed",
                action: "close",
                direction: existingDirection,
                quantity: Math.abs(existing.positionAmt),
            });
            return { executed: true, action: "close", direction: existingDirection };
        } catch (err) {
            log.error({ fn: "automateTrading", err }, 'Failed to close position');
            await emitDecision({
                status: "error",
                action: "close",
                direction: existingDirection,
                reason: "closeFailure",
                metadata: { error: err.message },
            });
            throw err;
        }
    }

    const positions = filterActivePositions(await getMarginPositionRisk(), automationCfg.positionEpsilon);
    const existing = findPositionForSymbol(positions, symbol, automationCfg.positionEpsilon);
    const existingDirection = derivePositionDirection(existing?.positionAmt, automationCfg.positionEpsilon);

    if (!existing && positions.length >= automationCfg.maxPositions) {
        log.warn({ fn: "automateTrading", positions: positions.length }, 'Skipped trade due to max positions');
        await emitDecision({
            status: "skipped",
            reason: "maxPositions",
            metadata: { activePositions: positions.length },
        });
        return { skipped: true, reason: "maxPositions" };
    }

    const price = snapshot?.kpis?.price;
    const quantity = computeQuantity({ price, positionPct: automationCfg.positionPct });
    if (quantity === null) {
        log.warn({ fn: "automateTrading", price }, 'Skipped trade due to invalid sizing');
        await emitDecision({
            status: "skipped",
            reason: "invalidSizing",
            metadata: { price },
        });
        return { skipped: true, reason: "invalidSizing" };
    }

    if (existingDirection === direction) {
        log.debug({ fn: "automateTrading", direction }, 'Position already aligned with signal');
        await emitDecision({
            status: "skipped",
            reason: "alreadyAligned",
            direction,
        });
        return { skipped: true, reason: "alreadyAligned" };
    }

    if (existingDirection !== "flat" && existingDirection !== direction) {
        try {
            await closePosition({
                symbol,
                assetKey,
                direction: existingDirection,
                quantity: Math.abs(existing.positionAmt),
                metadata: { referencePrice: price },
            });
            log.info({ fn: "automateTrading", from: existingDirection, to: direction }, 'Closed opposing position before reversal');
            await emitDecision({
                status: "executed",
                action: "close",
                direction: existingDirection,
                quantity: Math.abs(existing.positionAmt),
                metadata: { reason: "reverse" },
            });
        } catch (err) {
            log.error({ fn: "automateTrading", err }, 'Failed to close opposing position');
            await emitDecision({
                status: "error",
                action: "close",
                direction: existingDirection,
                reason: "reverseCloseFailure",
                metadata: { error: err.message },
            });
            throw err;
        }
    }

    try {
        await openPosition({
            symbol,
            assetKey,
            direction,
            quantity,
            metadata: { referencePrice: price },
        });
        log.info({ fn: "automateTrading", direction, quantity }, 'Opened automated position');
        await emitDecision({
            status: "executed",
            action: "open",
            direction,
            quantity,
            metadata: { price },
        });
        return { executed: true, action: "open", direction, quantity };
    } catch (err) {
        log.error({ fn: "automateTrading", err }, 'Failed to open position');
        await emitDecision({
            status: "error",
            action: "open",
            direction,
            quantity,
            reason: "openFailure",
            metadata: { error: err.message, price },
        });
        throw err;
    }
}

export const __private__ = {
    getTradingConfig,
    getAutomationConfig,
    mapDecisionToDirection,
    extractConfidence,
    filterActivePositions,
    findPositionForSymbol,
    computeQuantity,
    derivePositionDirection,
};
