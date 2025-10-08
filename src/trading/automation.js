import { CFG } from "../config.js";
import { logger, withContext } from "../logger.js";
import { getMarginPositionRisk } from "./binance.js";
import { openPosition, closePosition } from "./executor.js";
import { reportTradingDecision } from "./notifier.js";
import { evaluateTradeIntent } from "./riskManager.js";

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

function computePositionExposure(position, fallbackPrice) {
    if (!position) {
        return 0;
    }
    const qty = toFinite(position?.positionAmt);
    if (qty === null) {
        return 0;
    }
    const priceCandidates = [
        toFinite(position?.markPrice),
        toFinite(position?.entryPrice),
        toFinite(fallbackPrice),
    ];
    const referencePrice = priceCandidates.find(value => value !== null && value > 0);
    if (referencePrice === undefined) {
        return 0;
    }
    return Math.abs(qty) * referencePrice;
}

function computeExposureMetrics(positions, { referencePrices = {} } = {}) {
    if (!Array.isArray(positions) || positions.length === 0) {
        return { totalExposure: 0, exposures: {} };
    }
    const exposures = {};
    let totalExposure = 0;
    for (const position of positions) {
        const symbol = normalizeSymbol(position?.symbol);
        const fallbackPrice = symbol ? referencePrices[symbol] : undefined;
        const notional = computePositionExposure(position, fallbackPrice);
        if (notional <= 0 || !symbol) {
            continue;
        }
        totalExposure += notional;
        exposures[symbol] = (exposures[symbol] ?? 0) + notional;
    }
    return { totalExposure, exposures };
}

function buildRiskContext({ positions, symbol, price, snapshot }) {
    const normalizedSymbol = normalizeSymbol(symbol);
    const referencePrices = {};
    const resolvedPrice = toFinite(price);
    if (normalizedSymbol && resolvedPrice !== null && resolvedPrice > 0) {
        referencePrices[normalizedSymbol] = resolvedPrice;
    }
    const { totalExposure, exposures } = computeExposureMetrics(positions, { referencePrices });
    const accountEquity = toFinite(CFG.accountEquity);
    const dailyLoss = toFinite(snapshot?.kpis?.dailyLoss
        ?? snapshot?.metrics?.dailyLoss
        ?? snapshot?.risk?.dailyLoss);
    const volatility = {
        atr: toFinite(snapshot?.kpis?.atr ?? snapshot?.metrics?.atr),
        atrPct: toFinite(snapshot?.kpis?.atrPct ?? snapshot?.metrics?.atrPct),
        changePct: toFinite(snapshot?.kpis?.dayChangePct ?? snapshot?.metrics?.changePct),
        priceChangePct: toFinite(snapshot?.metrics?.priceChangePct),
        volatilityPct: toFinite(snapshot?.kpis?.volatilityPct ?? snapshot?.metrics?.volatilityPct),
        price: resolvedPrice,
    };
    return {
        accountEquity,
        totalExposure,
        symbolExposure: exposures,
        dailyLoss,
        volatility,
    };
}

function adjustExposureAfterClose(context, symbol, notional) {
    const normalizedSymbol = normalizeSymbol(symbol);
    const adjustedNotional = toFinite(notional);
    if (normalizedSymbol === null || adjustedNotional === null || adjustedNotional <= 0) {
        return context;
    }
    const baseExposure = toFinite(context?.totalExposure) ?? 0;
    const reducedTotal = Math.max(baseExposure - adjustedNotional, 0);
    const exposureMap = { ...(isPlainObject(context?.symbolExposure) ? context.symbolExposure : {}) };
    const existing = toFinite(exposureMap[normalizedSymbol]) ?? 0;
    const reducedSymbolExposure = Math.max(existing - adjustedNotional, 0);
    exposureMap[normalizedSymbol] = reducedSymbolExposure;
    return {
        ...context,
        totalExposure: reducedTotal,
        symbolExposure: exposureMap,
    };
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
        const price = snapshot?.kpis?.price;
        const riskContext = buildRiskContext({ positions, symbol, price, snapshot });
        const closeNotional = computePositionExposure(existing, price);
        const closeIntent = {
            source: "automation",
            action: "close",
            symbol,
            assetKey,
            direction: existingDirection,
            side: existingDirection === "short" ? "BUY" : "SELL",
            quantity: Math.abs(toFinite(existing.positionAmt) ?? 0),
            price,
            notional: closeNotional,
        };
        const closeAssessment = evaluateTradeIntent(closeIntent, riskContext);
        const closeCompliance = closeAssessment?.compliance;
        if (closeCompliance && closeCompliance.status !== "cleared") {
            log.warn({ fn: "automateTrading", compliance: closeCompliance }, "Closing position with compliance flags");
        }
        try {
            await closePosition({
                symbol,
                assetKey,
                direction: existingDirection,
                quantity: Math.abs(existing.positionAmt),
                metadata: {
                    referencePrice: price,
                    riskContext,
                    compliance: closeCompliance,
                },
            });
            log.info({ fn: "automateTrading", direction: existingDirection }, 'Closed position after flat signal');
            await emitDecision({
                status: "executed",
                action: "close",
                direction: existingDirection,
                quantity: Math.abs(existing.positionAmt),
                metadata: { compliance: closeCompliance },
            });
            return { executed: true, action: "close", direction: existingDirection };
        } catch (err) {
            log.error({ fn: "automateTrading", err }, 'Failed to close position');
            await emitDecision({
                status: "error",
                action: "close",
                direction: existingDirection,
                reason: "closeFailure",
                metadata: { error: err.message, compliance: closeCompliance },
            });
            throw err;
        }
    }

    const positions = filterActivePositions(await getMarginPositionRisk(), automationCfg.positionEpsilon);
    const existing = findPositionForSymbol(positions, symbol, automationCfg.positionEpsilon);
    const price = snapshot?.kpis?.price;
    const baseRiskContext = buildRiskContext({ positions, symbol, price, snapshot });
    const existingNotional = computePositionExposure(existing, price);
    const existingDirection = derivePositionDirection(existing?.positionAmt, automationCfg.positionEpsilon);
    const openRiskContext = existingDirection !== "flat" && existingDirection !== direction
        ? adjustExposureAfterClose(baseRiskContext, symbol, existingNotional)
        : baseRiskContext;

    if (!existing && positions.length >= automationCfg.maxPositions) {
        log.warn({ fn: "automateTrading", positions: positions.length }, 'Skipped trade due to max positions');
        await emitDecision({
            status: "skipped",
            reason: "maxPositions",
            metadata: { activePositions: positions.length },
        });
        return { skipped: true, reason: "maxPositions" };
    }

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
        const reverseIntent = {
            source: "automation",
            action: "close",
            symbol,
            assetKey,
            direction: existingDirection,
            side: existingDirection === "short" ? "BUY" : "SELL",
            quantity: Math.abs(toFinite(existing?.positionAmt) ?? 0),
            price,
            notional: existingNotional,
        };
        const reverseAssessment = evaluateTradeIntent(reverseIntent, baseRiskContext);
        const reverseCompliance = reverseAssessment?.compliance;
        if (reverseCompliance && reverseCompliance.status !== "cleared") {
            log.warn({ fn: "automateTrading", compliance: reverseCompliance }, "Reversal close flagged by risk manager");
        }
        try {
            await closePosition({
                symbol,
                assetKey,
                direction: existingDirection,
                quantity: Math.abs(existing.positionAmt),
                metadata: {
                    referencePrice: price,
                    riskContext: baseRiskContext,
                    compliance: reverseCompliance,
                },
            });
            log.info({ fn: "automateTrading", from: existingDirection, to: direction }, 'Closed opposing position before reversal');
            await emitDecision({
                status: "executed",
                action: "close",
                direction: existingDirection,
                quantity: Math.abs(existing.positionAmt),
                metadata: { reason: "reverse", compliance: reverseCompliance },
            });
        } catch (err) {
            log.error({ fn: "automateTrading", err }, 'Failed to close opposing position');
            await emitDecision({
                status: "error",
                action: "close",
                direction: existingDirection,
                reason: "reverseCloseFailure",
                metadata: { error: err.message, compliance: reverseCompliance },
            });
            throw err;
        }
    }

    let openQuantity = quantity;
    let compliance = null;
    try {
        const openIntent = {
            source: "automation",
            action: "open",
            symbol,
            assetKey,
            direction,
            side: direction === "short" ? "SELL" : "BUY",
            quantity,
            price,
            notional: Number.isFinite(price) && Number.isFinite(quantity) ? quantity * price : null,
            volatility: openRiskContext.volatility,
        };
        const openAssessment = evaluateTradeIntent(openIntent, openRiskContext);
        compliance = openAssessment?.compliance ?? null;
        if (openAssessment.decision === "block") {
            log.warn({ fn: "automateTrading", compliance }, "Risk manager blocked automated trade");
            await emitDecision({
                status: "skipped",
                reason: `risk:${openAssessment.reason ?? "blocked"}`,
                direction,
                quantity,
                metadata: { price, compliance },
            });
            return { skipped: true, reason: "risk", compliance };
        }
        if (openAssessment.decision === "scale") {
            log.warn({ fn: "automateTrading", compliance }, "Risk manager scaled automated trade");
            if (Number.isFinite(openAssessment.quantity) && openAssessment.quantity > 0) {
                openQuantity = openAssessment.quantity;
            }
        }
        if (!Number.isFinite(openQuantity) || openQuantity <= 0) {
            log.warn({ fn: "automateTrading", compliance }, "Risk manager produced invalid quantity");
            await emitDecision({
                status: "skipped",
                reason: "risk:invalidQuantity",
                direction,
                quantity,
                metadata: { price, compliance },
            });
            return { skipped: true, reason: "risk", compliance };
        }

        if (compliance && compliance.status === "flagged") {
            log.warn({ fn: "automateTrading", compliance }, "Risk manager flagged automated trade");
        }

        const metadata = {
            referencePrice: price,
            riskContext: openRiskContext,
            compliance,
        };

        await openPosition({
            symbol,
            assetKey,
            direction,
            quantity: openQuantity,
            metadata,
        });
        log.info({ fn: "automateTrading", direction, quantity: openQuantity }, 'Opened automated position');
        await emitDecision({
            status: "executed",
            action: "open",
            direction,
            quantity: openQuantity,
            metadata: { price, compliance },
        });
        return { executed: true, action: "open", direction, quantity: openQuantity, compliance };
    } catch (err) {
        log.error({ fn: "automateTrading", err }, 'Failed to open position');
        await emitDecision({
            status: "error",
            action: "open",
            direction,
            quantity: openQuantity,
            reason: "openFailure",
            metadata: { error: err.message, price, compliance },
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
    computePositionExposure,
    computeExposureMetrics,
    buildRiskContext,
    adjustExposureAfterClose,
};
