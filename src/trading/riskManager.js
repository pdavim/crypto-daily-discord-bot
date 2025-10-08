import { CFG } from "../config.js";

const EPSILON = 1e-9;

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toFiniteNumber(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSymbol(symbol) {
    if (typeof symbol !== "string") {
        return null;
    }
    const trimmed = symbol.trim();
    return trimmed === "" ? null : trimmed.toUpperCase();
}

function getRiskPolicy() {
    const policy = CFG?.trading?.riskPolicy;
    if (!isPlainObject(policy)) {
        return {
            maxExposurePct: null,
            maxExposureValue: null,
            maxDailyLossPct: null,
            maxDailyLossValue: null,
            volatilityTriggers: {},
            blacklist: { symbols: [], reasons: {} },
        };
    }
    return policy;
}

function computeLimit({ pct, absolute, equity }) {
    const limits = [];
    if (Number.isFinite(pct) && pct > 0 && Number.isFinite(equity) && equity > 0) {
        limits.push(equity * pct);
    }
    if (Number.isFinite(absolute) && absolute > 0) {
        limits.push(absolute);
    }
    if (limits.length === 0) {
        return null;
    }
    return Math.min(...limits);
}

function mergeUniqueStrings(primary = [], secondary = []) {
    const values = [];
    const seen = new Set();
    for (const list of [primary, secondary]) {
        for (const entry of list) {
            if (typeof entry !== "string") {
                continue;
            }
            const trimmed = entry.trim();
            if (trimmed === "" || seen.has(trimmed)) {
                continue;
            }
            seen.add(trimmed);
            values.push(trimmed);
        }
    }
    return values;
}

function mergeBreaches(primary = [], secondary = []) {
    const entries = [];
    const seen = new Set();
    for (const list of [primary, secondary]) {
        for (const breach of list) {
            if (!isPlainObject(breach)) {
                continue;
            }
            const key = JSON.stringify({
                type: breach.type ?? null,
                severity: breach.severity ?? null,
                limit: breach.limit ?? null,
                value: breach.value ?? null,
                metric: breach.metric ?? null,
                message: breach.message ?? null,
                symbol: breach.symbol ?? null,
            });
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            entries.push({ ...breach });
        }
    }
    return entries;
}

const COMPLIANCE_PRIORITY = {
    blocked: 3,
    scaled: 2,
    flagged: 1,
    cleared: 0,
};

function normalizeCompliance(compliance) {
    if (!isPlainObject(compliance)) {
        return {
            status: "cleared",
            decision: "allow",
            breaches: [],
            messages: [],
            sources: [],
        };
    }
    const status = typeof compliance.status === "string" ? compliance.status : "cleared";
    let decision;
    if (typeof compliance.decision === "string") {
        decision = compliance.decision;
    } else if (status === "blocked") {
        decision = "block";
    } else if (status === "scaled") {
        decision = "scale";
    } else {
        decision = "allow";
    }
    return {
        status,
        decision,
        breaches: Array.isArray(compliance.breaches) ? compliance.breaches.slice() : [],
        messages: Array.isArray(compliance.messages) ? compliance.messages.slice() : [],
        policy: isPlainObject(compliance.policy) ? { ...compliance.policy } : undefined,
        context: isPlainObject(compliance.context) ? { ...compliance.context } : undefined,
        reason: typeof compliance.reason === "string" ? compliance.reason : undefined,
        evaluatedAt: compliance.evaluatedAt,
        sources: Array.isArray(compliance.sources) ? compliance.sources.slice() : [],
    };
}

export function mergeCompliance(...inputs) {
    return inputs.reduce((acc, entry) => {
        const normalized = normalizeCompliance(entry);
        const accPriority = COMPLIANCE_PRIORITY[acc.status] ?? 0;
        const entryPriority = COMPLIANCE_PRIORITY[normalized.status] ?? 0;

        const status = entryPriority > accPriority ? normalized.status : acc.status;
        let decision;
        if (status === "blocked") {
            decision = "block";
        } else if (status === "scaled") {
            decision = "scale";
        } else {
            decision = "allow";
        }

        return {
            status,
            decision,
            breaches: mergeBreaches(acc.breaches, normalized.breaches),
            messages: mergeUniqueStrings(acc.messages, normalized.messages),
            policy: { ...(acc.policy ?? {}), ...(normalized.policy ?? {}) },
            context: { ...(acc.context ?? {}), ...(normalized.context ?? {}) },
            reason: normalized.reason ?? acc.reason,
            evaluatedAt: normalized.evaluatedAt ?? acc.evaluatedAt,
            sources: mergeUniqueStrings(acc.sources, normalized.sources),
        };
    }, normalizeCompliance());
}

export function evaluateTradeIntent(intent = {}, context = {}) {
    const policy = getRiskPolicy();
    const action = typeof intent.action === "string"
        ? intent.action.toLowerCase()
        : intent.direction === "close"
            ? "close"
            : "open";
    const sourceTag = typeof intent.source === "string" && intent.source.trim() !== ""
        ? intent.source.trim()
        : "unknown";

    const symbol = normalizeSymbol(intent.symbol);
    const quantity = toFiniteNumber(intent.quantity);
    const price = toFiniteNumber(intent.price ?? intent.metadata?.referencePrice);
    let notional = toFiniteNumber(intent.notional);
    if (!Number.isFinite(notional) && Number.isFinite(quantity) && quantity > 0 && Number.isFinite(price) && price > 0) {
        notional = quantity * price;
    }
    const accountEquity = toFiniteNumber(context.accountEquity ?? CFG.accountEquity);
    const totalExposure = Math.max(toFiniteNumber(context.totalExposure) ?? 0, 0);
    const symbolExposureMap = isPlainObject(context.symbolExposure) ? context.symbolExposure : {};
    const symbolExposure = symbol ? Math.max(toFiniteNumber(symbolExposureMap[symbol]) ?? 0, 0) : 0;
    const dailyLoss = Math.abs(toFiniteNumber(context.dailyLoss) ?? 0);
    const volatilityContext = isPlainObject(context.volatility) ? context.volatility : {};
    const volatilityIntent = isPlainObject(intent.volatility) ? intent.volatility : {};
    const volatility = { ...volatilityContext, ...volatilityIntent };

    const compliance = {
        status: "cleared",
        decision: "allow",
        reason: null,
        action,
        symbol,
        evaluatedAt: new Date().toISOString(),
        policy: {
            maxExposurePct: policy.maxExposurePct ?? null,
            maxExposureValue: policy.maxExposureValue ?? null,
            maxDailyLossPct: policy.maxDailyLossPct ?? null,
            maxDailyLossValue: policy.maxDailyLossValue ?? null,
            volatilityTriggers: isPlainObject(policy.volatilityTriggers)
                ? { ...policy.volatilityTriggers }
                : {},
            blacklistCount: Array.isArray(policy.blacklist?.symbols) ? policy.blacklist.symbols.length : 0,
        },
        context: {
            accountEquity,
            totalExposure,
            symbolExposure,
            notional,
            dailyLoss,
        },
        breaches: [],
        messages: [],
        sources: [sourceTag],
    };

    let decision = "allow";
    let reason = null;
    let adjustedQuantity = Number.isFinite(quantity) ? quantity : null;
    let adjustedNotional = Number.isFinite(notional) ? notional : null;

    const addBreach = (breach) => {
        if (!isPlainObject(breach)) {
            return;
        }
        compliance.breaches.push(breach);
        if (typeof breach.message === "string" && breach.message.trim() !== "") {
            compliance.messages.push(breach.message.trim());
        }
    };

    const blacklistSymbols = Array.isArray(policy.blacklist?.symbols) ? policy.blacklist.symbols : [];
    if (symbol && blacklistSymbols.includes(symbol)) {
        const blacklistReason = policy.blacklist?.reasons?.[symbol] ?? `Trading ${symbol} is blacklisted`;
        const severity = action === "close" ? "warning" : "critical";
        addBreach({ type: "blacklist", severity, symbol, message: blacklistReason });
        if (action !== "close") {
            decision = "block";
            reason = "blacklist";
        }
    }

    if (action === "open") {
        const dailyLossLimit = computeLimit({
            pct: policy.maxDailyLossPct,
            absolute: policy.maxDailyLossValue,
            equity: accountEquity,
        });

        if (decision !== "block"
            && Number.isFinite(dailyLossLimit)
            && Number.isFinite(dailyLoss)
            && dailyLossLimit >= 0
            && dailyLoss + EPSILON >= dailyLossLimit) {
            decision = "block";
            reason = "dailyLoss";
            addBreach({
                type: "dailyLoss",
                severity: "critical",
                limit: dailyLossLimit,
                value: dailyLoss,
                message: `Daily loss ${dailyLoss.toFixed(2)} exceeds limit ${dailyLossLimit.toFixed(2)}`,
            });
        }

        const volatilityTriggers = isPlainObject(policy.volatilityTriggers) ? policy.volatilityTriggers : {};
        if (decision !== "block" && volatilityTriggers.enabled) {
            const atrPct = toFiniteNumber(volatility.atrPct);
            const atr = toFiniteNumber(volatility.atr);
            const referencePrice = Number.isFinite(price) && price > 0 ? price : toFiniteNumber(volatility.price);
            const derivedAtrPct = Number.isFinite(atr) && Number.isFinite(referencePrice) && referencePrice > 0
                ? atr / referencePrice
                : null;
            const resolvedAtrPct = Number.isFinite(atrPct) ? atrPct : derivedAtrPct;

            if (decision !== "block"
                && Number.isFinite(volatilityTriggers.maxAtrPct)
                && Number.isFinite(resolvedAtrPct)
                && resolvedAtrPct > volatilityTriggers.maxAtrPct + EPSILON) {
                decision = "block";
                reason = "volatility:atr";
                addBreach({
                    type: "volatility",
                    metric: "atrPct",
                    severity: "critical",
                    limit: volatilityTriggers.maxAtrPct,
                    value: resolvedAtrPct,
                    message: `ATR ratio ${resolvedAtrPct.toFixed(4)} exceeds ${volatilityTriggers.maxAtrPct}`,
                });
            }

            const changePct = Math.abs(toFiniteNumber(volatility.changePct ?? volatility.priceChangePct));
            if (decision !== "block"
                && Number.isFinite(volatilityTriggers.maxChangePct)
                && Number.isFinite(changePct)
                && changePct > volatilityTriggers.maxChangePct + EPSILON) {
                decision = "block";
                reason = "volatility:change";
                addBreach({
                    type: "volatility",
                    metric: "changePct",
                    severity: "critical",
                    limit: volatilityTriggers.maxChangePct,
                    value: changePct,
                    message: `Price change ${changePct.toFixed(4)} exceeds ${volatilityTriggers.maxChangePct}`,
                });
            }

            const volatilityPct = Math.abs(toFiniteNumber(volatility.volatilityPct ?? volatility.realizedVolatilityPct));
            if (decision !== "block"
                && Number.isFinite(volatilityTriggers.maxVolatilityPct)
                && Number.isFinite(volatilityPct)
                && volatilityPct > volatilityTriggers.maxVolatilityPct + EPSILON) {
                decision = "block";
                reason = "volatility:realized";
                addBreach({
                    type: "volatility",
                    metric: "volatilityPct",
                    severity: "critical",
                    limit: volatilityTriggers.maxVolatilityPct,
                    value: volatilityPct,
                    message: `Realized volatility ${volatilityPct.toFixed(4)} exceeds ${volatilityTriggers.maxVolatilityPct}`,
                });
            }
        }

        const exposureLimit = computeLimit({
            pct: policy.maxExposurePct,
            absolute: policy.maxExposureValue,
            equity: accountEquity,
        });

        if (decision !== "block"
            && Number.isFinite(exposureLimit)
            && Number.isFinite(notional)
            && notional > 0) {
            const projectedExposure = totalExposure + notional;
            if (projectedExposure > exposureLimit + EPSILON) {
                const allowedNotional = Math.max(exposureLimit - totalExposure, 0);
                if (allowedNotional <= 0) {
                    decision = "block";
                    reason = reason ?? "maxExposure";
                    addBreach({
                        type: "maxExposure",
                        severity: "critical",
                        limit: exposureLimit,
                        value: projectedExposure,
                        current: totalExposure,
                        message: `Projected exposure ${projectedExposure.toFixed(2)} exceeds limit ${exposureLimit.toFixed(2)}`,
                    });
                } else {
                    const scaleFactor = allowedNotional / notional;
                    const scaledQuantity = Number.isFinite(price) && price > 0
                        ? allowedNotional / price
                        : Number.isFinite(adjustedQuantity)
                            ? adjustedQuantity * scaleFactor
                            : null;

                    if (!Number.isFinite(scaledQuantity) || scaledQuantity <= 0) {
                        decision = "block";
                        reason = reason ?? "maxExposure";
                        addBreach({
                            type: "maxExposure",
                            severity: "critical",
                            limit: exposureLimit,
                            value: projectedExposure,
                            current: totalExposure,
                            message: `Exposure limit ${exposureLimit.toFixed(2)} leaves no room for order`,
                        });
                    } else {
                        decision = "scale";
                        reason = "maxExposure";
                        adjustedQuantity = scaledQuantity;
                        adjustedNotional = allowedNotional;
                        compliance.context.notional = adjustedNotional;
                        addBreach({
                            type: "maxExposure",
                            severity: "warning",
                            limit: exposureLimit,
                            value: projectedExposure,
                            current: totalExposure,
                            message: `Scaled order to ${allowedNotional.toFixed(2)} notional to respect exposure limit ${exposureLimit.toFixed(2)}`,
                        });
                    }
                }
            }
        }
    }

    if (decision === "block") {
        compliance.status = "blocked";
        compliance.decision = "block";
    } else if (decision === "scale") {
        compliance.status = "scaled";
        compliance.decision = "scale";
    } else if (compliance.breaches.length > 0) {
        compliance.status = "flagged";
        compliance.decision = "allow";
    }

    compliance.messages = mergeUniqueStrings(compliance.messages);
    compliance.reason = reason;

    return {
        decision,
        reason,
        quantity: adjustedQuantity,
        notional: adjustedNotional,
        compliance,
    };
}

export const __private__ = {
    computeLimit,
    normalizeSymbol,
    mergeBreaches,
    mergeUniqueStrings,
};
