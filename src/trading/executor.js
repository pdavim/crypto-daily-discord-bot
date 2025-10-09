import { CFG, getAssetConfig } from "../config.js";
import { logger, withContext } from "../logger.js";
import { tradingExecutionCounter, tradingNotionalHistogram } from "../metrics.js";

import { reportTradingExecution, reportTradingMargin } from "./notifier.js";
import { evaluateTradeIntent, mergeCompliance } from "./riskManager.js";
import { getExchangeConnector, resolveConnectorForAsset } from "../exchanges/index.js";

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toFiniteNumber(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function getTradingConfig() {
    return isPlainObject(CFG.trading) ? CFG.trading : { enabled: false };
}

function computeMaxNotionalLimit(tradingCfg) {
    const equity = toFiniteNumber(CFG.accountEquity);
    const maxPct = toFiniteNumber(tradingCfg.maxPositionPct);
    const leverage = toFiniteNumber(tradingCfg.maxLeverage) ?? 1;
    if (equity === null || equity <= 0 || maxPct === null || maxPct <= 0) {
        return null;
    }
    const lev = leverage !== null && leverage > 0 ? leverage : 1;
    return equity * maxPct * lev;
}

function primarySymbolForAsset(asset) {
    if (!asset) {
        return null;
    }
    const direct = typeof asset.symbol === "string" ? asset.symbol.trim() : "";
    if (direct) {
        return direct;
    }
    const symbols = asset.symbols ?? {};
    for (const key of ["market", "spot", "stream"]) {
        const value = typeof symbols[key] === "string" ? symbols[key].trim() : "";
        if (value) {
            return value;
        }
    }
    for (const value of Object.values(symbols)) {
        if (typeof value === "string" && value.trim() !== "") {
            return value.trim();
        }
    }
    return null;
}

function findAssetByKeyOrSymbol(assetKey, symbol) {
    if (typeof assetKey === "string" && assetKey.trim() !== "") {
        const asset = getAssetConfig(assetKey.trim().toUpperCase());
        if (asset) {
            return asset;
        }
    }
    if (typeof symbol === "string" && symbol.trim() !== "") {
        const normalized = symbol.trim().toUpperCase();
        const assets = Array.isArray(CFG.assets) ? CFG.assets : [];
        for (const asset of assets) {
            const candidates = new Set();
            const direct = primarySymbolForAsset(asset);
            if (direct) {
                candidates.add(direct.toUpperCase());
            }
            const symbols = asset.symbols ?? {};
            for (const value of Object.values(symbols)) {
                if (typeof value === "string" && value.trim() !== "") {
                    candidates.add(value.trim().toUpperCase());
                }
            }
            if (candidates.has(normalized)) {
                return asset;
            }
        }
    }
    return null;
}

function resolveConnectorContext({ assetKey, symbol }) {
    const asset = findAssetByKeyOrSymbol(assetKey, symbol);
    let connector = asset ? resolveConnectorForAsset(asset) : null;
    if (!connector) {
        connector = getExchangeConnector('binance');
    }
    const resolvedSymbol = symbol ?? primarySymbolForAsset(asset);
    return { asset, connector, symbol: resolvedSymbol };
}

function recordTradeOutcome(action, result, { notional } = {}) {
    try {
        tradingExecutionCounter.labels(action, result).inc();
    } catch (err) {
        logger.debug({ fn: action, err }, 'Failed to record trading metric');
    }
    if (result === 'success' && Number.isFinite(notional) && notional > 0) {
        try {
            tradingNotionalHistogram.observe(notional);
        } catch (err) {
            logger.debug({ fn: action, err }, 'Failed to record trading notional metric');
        }
    }
}

function abortTrade(log, fn, reason, details = {}, context = {}) {
    recordTradeOutcome(fn, 'skipped');

    log.warn({ fn, reason, ...details }, 'Skipped automated trade');
    const action = context.action ?? (fn === 'openPosition' ? 'open' : fn === 'closePosition' ? 'close' : fn);
    const maybeReport = reportTradingExecution({
        assetKey: context.assetKey,
        symbol: context.symbol,
        timeframe: context.timeframe,
        action,
        status: 'skipped',
        side: context.side,
        quantity: context.quantity,
        price: context.price,
        notional: context.notional,
        reason,
        metadata: { ...details, ...(context.metadata ?? {}) },
    });
    if (maybeReport && typeof maybeReport.catch === 'function') {
        maybeReport.catch((err) => {
            log.debug({ fn, err }, 'Failed to report skipped trading execution');
        });
    }
    return { executed: false, reason, details };
}

function ensureOrderPrice(price, type) {
    if (type !== "MARKET") {
        const parsed = toFiniteNumber(price);
        if (parsed === null || parsed <= 0) {
            throw new Error("Limit and stop orders require a price");
        }
        return parsed;
    }
    const parsed = toFiniteNumber(price);
    return parsed !== null && parsed > 0 ? parsed : null;
}

function buildOrderParams(params) {
    return isPlainObject(params) ? params : {};
}

export async function openPosition({
    symbol,
    assetKey,
    direction = "long",
    quantity,
    price,
    type = "MARKET",
    params,
    metadata = {},
} = {}) {
    const tradingCfg = getTradingConfig();
    const log = withContext(logger, { asset: assetKey ?? symbol, symbol, action: 'openPosition' });
    const metadataPayload = isPlainObject(metadata) ? { ...metadata } : {};

    if (!tradingCfg.enabled) {
        return abortTrade(log, 'openPosition', 'disabled', {}, { assetKey, symbol, action: 'open', direction });
    }

    if (!symbol) {
        return abortTrade(log, 'openPosition', 'missingSymbol', {}, { assetKey, symbol, action: 'open', direction });
    }

    let qty = toFiniteNumber(quantity);
    if (qty === null || qty <= 0) {
        return abortTrade(log, 'openPosition', 'invalidQuantity', { quantity }, {
            assetKey,
            symbol,
            action: 'open',
            direction,
            quantity,
        });
    }

    let referencePrice;
    try {
        referencePrice = ensureOrderPrice(price ?? metadataPayload.referencePrice, type);
    } catch (err) {
        return abortTrade(log, 'openPosition', 'invalidPrice', { message: err.message }, {
            assetKey,
            symbol,
            action: 'open',
            direction,
            quantity: qty,
            metadata: metadataPayload,
        });
    }

    if (referencePrice === null && tradingCfg.minNotional > 0) {
        return abortTrade(log, 'openPosition', 'missingPrice', {}, {
            assetKey,
            symbol,
            action: 'open',
            direction,
            quantity: qty,
            metadata: metadataPayload,
        });
    }

    let notional = referencePrice !== null ? qty * referencePrice : null;
    if (Number.isFinite(tradingCfg.minNotional) && tradingCfg.minNotional > 0 && notional !== null && notional < tradingCfg.minNotional) {
        return abortTrade(log, 'openPosition', 'belowMinNotional', {
            notional,
            minNotional: tradingCfg.minNotional,
        }, {
            assetKey,
            symbol,
            action: 'open',
            direction,
            quantity: qty,
            price: referencePrice,
            notional,
            metadata: metadataPayload,
        });
    }

    const side = direction === 'short' ? 'SELL' : 'BUY';

    const riskContext = isPlainObject(metadataPayload.riskContext)
        ? { ...metadataPayload.riskContext }
        : {};
    if (!Number.isFinite(riskContext.accountEquity)) {
        riskContext.accountEquity = toFiniteNumber(CFG.accountEquity);
    }

    const riskEvaluation = evaluateTradeIntent({
        source: metadataPayload.source ?? 'executor',
        action: 'open',
        symbol,
        assetKey,
        direction,
        side,
        quantity: qty,
        price: referencePrice,
        notional,
        type,
    }, riskContext);

    let compliance = mergeCompliance(metadataPayload.compliance, riskEvaluation.compliance);
    metadataPayload.riskContext = riskContext;
    metadataPayload.compliance = compliance;

    if (riskEvaluation.decision === 'block') {
        return abortTrade(log, 'openPosition', `risk:${riskEvaluation.reason ?? 'blocked'}`, { compliance }, {
            assetKey,
            symbol,
            action: 'open',
            direction,
            quantity: qty,
            price: referencePrice,
            notional,
            metadata: metadataPayload,
        });
    }

    if (riskEvaluation.decision === 'scale') {
        if (!Number.isFinite(riskEvaluation.quantity) || riskEvaluation.quantity <= 0) {
            return abortTrade(log, 'openPosition', 'risk:invalidQuantity', { compliance }, {
                assetKey,
                symbol,
                action: 'open',
                direction,
                quantity: qty,
                price: referencePrice,
                notional,
                metadata: metadataPayload,
            });
        }
        qty = riskEvaluation.quantity;
        notional = riskEvaluation.notional ?? (referencePrice !== null ? qty * referencePrice : null);
        compliance = mergeCompliance(compliance, riskEvaluation.compliance);
        metadataPayload.compliance = compliance;
        if (Number.isFinite(tradingCfg.minNotional) && tradingCfg.minNotional > 0 && notional !== null && notional < tradingCfg.minNotional) {
            return abortTrade(log, 'openPosition', 'riskScaledBelowMinNotional', {
                notional,
                minNotional: tradingCfg.minNotional,
                compliance,
            }, {
                assetKey,
                symbol,
                action: 'open',
                direction,
                quantity: qty,
                price: referencePrice,
                notional,
                metadata: metadataPayload,
            });
        }
    }

    if (compliance && compliance.status === 'flagged') {
        log.warn({ fn: 'openPosition', compliance }, 'Executing trade with compliance flags');
    }

    const orderParams = buildOrderParams(params);
    const { connector, asset: assetConfig, symbol: resolvedSymbol } = resolveConnectorContext({ assetKey, symbol });
    const effectiveAssetKey = assetKey ?? assetConfig?.key ?? symbol;

    if (!connector || typeof connector.placeOrder !== 'function' || !resolvedSymbol) {
        return abortTrade(log, 'openPosition', 'connectorUnavailable', {}, {
            assetKey: effectiveAssetKey,
            symbol,
            action: 'open',
            direction,
            quantity: qty,
            price: referencePrice,
            notional,
            metadata: metadataPayload,
        });
    }

    try {
        const order = await connector.placeOrder({
            symbol: resolvedSymbol,
            side,
            type,
            quantity: qty,
            price: type === 'MARKET' ? undefined : referencePrice,
            params: orderParams,
        }, { context: { asset: effectiveAssetKey, direction: side } });
        const payload = {
            fn: 'openPosition',
            orderId: order.orderId,
            side,
            quantity: qty,
            fillPrice: order.fillPrice,
            notional,
        };
        log.info(payload, 'Opened automated trade');
        try {
            await reportTradingExecution({
                assetKey: effectiveAssetKey,
                symbol: resolvedSymbol,
                action: 'open',
                status: 'executed',
                side,
                quantity: qty,
                price: order.fillPrice ?? referencePrice,
                notional,
                orderId: order.orderId,
                metadata: metadataPayload,
            });
        } catch (notifyErr) {
            log.debug({ fn: 'openPosition', err: notifyErr }, 'Failed to report trading execution success');
        }
        recordTradeOutcome('openPosition', 'success', { notional });
        return { executed: true, order };
    } catch (err) {
        log.error({ fn: 'openPosition', err }, 'Failed to open position');
        try {
            await reportTradingExecution({
                assetKey: effectiveAssetKey,
                symbol: resolvedSymbol,
                action: 'open',
                status: 'error',
                side,
                quantity: qty,
                price: referencePrice,
                notional,
                reason: err.message,
                metadata: metadataPayload,
            });
        } catch (notifyErr) {
            log.debug({ fn: 'openPosition', err: notifyErr }, 'Failed to report trading execution error');
        }
        recordTradeOutcome('openPosition', 'error');
        throw err;
    }
}

export async function closePosition({
    symbol,
    assetKey,
    direction = "long",
    quantity,
    price,
    type = "MARKET",
    params,
    metadata = {},
} = {}) {
    const tradingCfg = getTradingConfig();
    const log = withContext(logger, { asset: assetKey ?? symbol, symbol, action: 'closePosition' });
    const metadataPayload = isPlainObject(metadata) ? { ...metadata } : {};

    if (!tradingCfg.enabled) {
        return abortTrade(log, 'closePosition', 'disabled', {}, { assetKey, symbol, action: 'close', direction });
    }

    if (!symbol) {
        return abortTrade(log, 'closePosition', 'missingSymbol', {}, { assetKey, symbol, action: 'close', direction });
    }

    let qty = toFiniteNumber(quantity);
    if (qty === null || qty <= 0) {
        return abortTrade(log, 'closePosition', 'invalidQuantity', { quantity }, {
            assetKey,
            symbol,
            action: 'close',
            direction,
            quantity,
        });
    }

    let referencePrice;
    try {
        referencePrice = ensureOrderPrice(price ?? metadataPayload.referencePrice, type);
    } catch (err) {
        return abortTrade(log, 'closePosition', 'invalidPrice', { message: err.message }, {
            assetKey,
            symbol,
            action: 'close',
            direction,
            quantity: qty,
            metadata: metadataPayload,
        });
    }

    if (referencePrice === null && tradingCfg.minNotional > 0) {
        return abortTrade(log, 'closePosition', 'missingPrice', {}, {
            assetKey,
            symbol,
            action: 'close',
            direction,
            quantity: qty,
            metadata: metadataPayload,
        });
    }

    let notional = referencePrice !== null ? qty * referencePrice : null;
    const maxNotional = computeMaxNotionalLimit(tradingCfg);
    if (maxNotional !== null && notional !== null && notional > maxNotional * 1.5) {
        return abortTrade(log, 'closePosition', 'exceedsCloseLimit', {
            notional,
            maxNotional,
        }, {
            assetKey,
            symbol,
            action: 'close',
            direction,
            quantity: qty,
            price: referencePrice,
            notional,
            metadata: metadataPayload,
        });
    }

    const side = direction === 'short' ? 'BUY' : 'SELL';
    const orderParams = buildOrderParams({ reduceOnly: true, ...params });

    const riskContext = isPlainObject(metadataPayload.riskContext)
        ? { ...metadataPayload.riskContext }
        : {};
    if (!Number.isFinite(riskContext.accountEquity)) {
        riskContext.accountEquity = toFiniteNumber(CFG.accountEquity);
    }

    const riskEvaluation = evaluateTradeIntent({
        source: metadataPayload.source ?? 'executor',
        action: 'close',
        symbol,
        assetKey,
        direction,
        side,
        quantity: qty,
        price: referencePrice,
        notional,
        type,
    }, riskContext);

    const compliance = mergeCompliance(metadataPayload.compliance, riskEvaluation.compliance);
    metadataPayload.riskContext = riskContext;
    metadataPayload.compliance = compliance;

    if (riskEvaluation.decision === 'block') {
        log.warn({ fn: 'closePosition', compliance }, 'Risk manager flagged close order');
    }

    if (riskEvaluation.decision === 'scale' && Number.isFinite(riskEvaluation.quantity) && riskEvaluation.quantity > 0) {
        qty = riskEvaluation.quantity;
        notional = referencePrice !== null ? qty * referencePrice : notional;
    }

    const { connector, asset: assetConfig, symbol: resolvedSymbol } = resolveConnectorContext({ assetKey, symbol });
    const effectiveAssetKey = assetKey ?? assetConfig?.key ?? symbol;

    if (!connector || typeof connector.placeOrder !== 'function' || !resolvedSymbol) {
        return abortTrade(log, 'closePosition', 'connectorUnavailable', {}, {
            assetKey: effectiveAssetKey,
            symbol,
            action: 'close',
            direction,
            quantity: qty,
            price: referencePrice,
            notional,
            metadata: metadataPayload,
        });
    }

    try {
        const order = await connector.placeOrder({
            symbol: resolvedSymbol,
            side,
            type,
            quantity: qty,
            price: type === 'MARKET' ? undefined : referencePrice,
            params: orderParams,
        }, { context: { asset: effectiveAssetKey, direction: side, intent: 'close' } });
        const payload = {
            fn: 'closePosition',
            orderId: order.orderId,
            side,
            quantity: qty,
            fillPrice: order.fillPrice,
            notional,
        };
        log.info(payload, 'Closed automated trade');
        try {
            await reportTradingExecution({
                assetKey: effectiveAssetKey,
                symbol: resolvedSymbol,
                action: 'close',
                status: 'executed',
                side,
                quantity: qty,
                price: order.fillPrice ?? referencePrice,
                notional,
                orderId: order.orderId,
                metadata: metadataPayload,
            });
        } catch (notifyErr) {
            log.debug({ fn: 'closePosition', err: notifyErr }, 'Failed to report trading execution success');
        }
        recordTradeOutcome('closePosition', 'success', { notional });
        return { executed: true, order };
    } catch (err) {
        log.error({ fn: 'closePosition', err }, 'Failed to close position');
        try {
            await reportTradingExecution({
                assetKey: effectiveAssetKey,
                symbol: resolvedSymbol,
                action: 'close',
                status: 'error',
                side,
                quantity: qty,
                price: referencePrice,
                notional,
                reason: err.message,
                metadata: metadataPayload,
            });
        } catch (notifyErr) {
            log.debug({ fn: 'closePosition', err: notifyErr }, 'Failed to report trading execution error');
        }
        recordTradeOutcome('closePosition', 'error');
        throw err;
    }
}

export async function adjustMargin({
    asset,
    amount,
    operation = "transferIn",
} = {}) {
    const tradingCfg = getTradingConfig();
    const marginCfg = isPlainObject(tradingCfg.margin) ? tradingCfg.margin : {};
    const resolvedAsset = (asset ?? marginCfg.asset ?? "USDT").toUpperCase();
    const baseAmount = toFiniteNumber(amount);
    const fallbackAmount = baseAmount ?? toFiniteNumber(marginCfg.transferAmount);
    const log = withContext(logger, { asset: resolvedAsset, action: 'adjustMargin' });
    const connector = getExchangeConnector('binance');

    if (!connector || typeof connector.transferMargin !== 'function') {
        log.warn({ fn: 'adjustMargin' }, 'Connector does not support margin adjustments');
        recordTradeOutcome('adjustMargin', 'skipped');
        try {
            await reportTradingMargin({
                asset: resolvedAsset,
                amount: fallbackAmount,
                operation,
                status: 'skipped',
                reason: 'connectorUnavailable',
            });
        } catch (_) {}
        return { adjusted: false, reason: 'connectorUnavailable' };
    }

    if (!tradingCfg.enabled) {
        recordTradeOutcome('adjustMargin', 'skipped');
        try {
            await reportTradingMargin({
                asset: resolvedAsset,
                amount: fallbackAmount,
                operation,
                status: 'skipped',
                reason: 'disabled',
            });
        } catch (_) {
            // ignore reporting failures during shutdown paths
        }
        return { adjusted: false, reason: 'disabled' };
    }

    if (fallbackAmount === null || fallbackAmount <= 0) {
        log.warn({ fn: 'adjustMargin', amount }, 'Skipped margin adjustment due to invalid amount');
        recordTradeOutcome('adjustMargin', 'skipped');
        try {
            await reportTradingMargin({
                asset: resolvedAsset,
                amount: fallbackAmount ?? amount,
                operation,
                status: 'skipped',
                reason: 'invalidAmount',
            });
        } catch (_) {}
        return { adjusted: false, reason: 'invalidAmount' };
    }

    if (operation === 'transferOut' && Number.isFinite(marginCfg.minFree) && fallbackAmount > marginCfg.minFree) {
        log.warn({ fn: 'adjustMargin', amount: fallbackAmount, minFree: marginCfg.minFree }, 'Skipped margin adjustment to preserve buffer');
        recordTradeOutcome('adjustMargin', 'skipped');
        try {
            await reportTradingMargin({
                asset: resolvedAsset,
                amount: fallbackAmount,
                operation,
                status: 'skipped',
                reason: 'exceedsBuffer',
            });
        } catch (_) {}
        return { adjusted: false, reason: 'exceedsBuffer' };
    }

    try {
        if (operation === 'transferIn') {
            const response = await connector.transferMargin({ asset: resolvedAsset, amount: fallbackAmount, direction: 'toMargin' });
            log.info({ fn: 'adjustMargin', amount: fallbackAmount, operation }, 'Transferred funds to margin');
            recordTradeOutcome('adjustMargin', 'success');
            try {
                await reportTradingMargin({
                    asset: resolvedAsset,
                    amount: fallbackAmount,
                    operation,
                    status: 'success',
                });
            } catch (_) {}
            return { adjusted: true, response };
        }
        if (operation === 'transferOut') {
            const response = await connector.transferMargin({ asset: resolvedAsset, amount: fallbackAmount, direction: 'toSpot' });
            log.info({ fn: 'adjustMargin', amount: fallbackAmount, operation }, 'Transferred funds to spot');
            recordTradeOutcome('adjustMargin', 'success');
            try {
                await reportTradingMargin({
                    asset: resolvedAsset,
                    amount: fallbackAmount,
                    operation,
                    status: 'success',
                });
            } catch (_) {}
            return { adjusted: true, response };
        }
        if (operation === 'borrow') {
            if (typeof connector.borrowMargin !== 'function') {
                throw new Error('Connector does not support margin borrow');
            }
            const response = await connector.borrowMargin({ asset: resolvedAsset, amount: fallbackAmount });
            log.info({ fn: 'adjustMargin', amount: fallbackAmount, operation }, 'Borrowed margin asset');
            recordTradeOutcome('adjustMargin', 'success');
            try {
                await reportTradingMargin({
                    asset: resolvedAsset,
                    amount: fallbackAmount,
                    operation,
                    status: 'success',
                });
            } catch (_) {}
            return { adjusted: true, response };
        }
        if (operation === 'repay') {
            if (typeof connector.repayMargin !== 'function') {
                throw new Error('Connector does not support margin repay');
            }
            const response = await connector.repayMargin({ asset: resolvedAsset, amount: fallbackAmount });
            log.info({ fn: 'adjustMargin', amount: fallbackAmount, operation }, 'Repaid margin loan');
            recordTradeOutcome('adjustMargin', 'success');
            try {
                await reportTradingMargin({
                    asset: resolvedAsset,
                    amount: fallbackAmount,
                    operation,
                    status: 'success',
                });
            } catch (_) {}
            return { adjusted: true, response };
        }
    } catch (err) {
        log.error({ fn: 'adjustMargin', err, operation }, 'Margin adjustment failed');
        recordTradeOutcome('adjustMargin', 'error');
        try {
            await reportTradingMargin({
                asset: resolvedAsset,
                amount: fallbackAmount,
                operation,
                status: 'error',
                reason: err.message,
            });
        } catch (_) {}
        throw err;
    }

    log.warn({ fn: 'adjustMargin', operation }, 'Skipped margin adjustment due to unsupported operation');
    recordTradeOutcome('adjustMargin', 'skipped');
    try {
        await reportTradingMargin({
            asset: resolvedAsset,
            amount: fallbackAmount,
            operation,
            status: 'skipped',
            reason: 'unsupportedOperation',
        });
    } catch (_) {}
    return { adjusted: false, reason: 'unsupportedOperation' };
}

export { computeMaxNotionalLimit };
