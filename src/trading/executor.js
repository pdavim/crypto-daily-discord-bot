import { CFG } from "../config.js";
import { logger, withContext } from "../logger.js";
import { tradingExecutionCounter, tradingNotionalHistogram } from "../metrics.js";

import { submitOrder, transferMargin, borrowMargin, repayMargin } from "./binance.js";
import { reportTradingExecution, reportTradingMargin } from "./notifier.js";

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

    if (!tradingCfg.enabled) {
        return abortTrade(log, 'openPosition', 'disabled', {}, { assetKey, symbol, action: 'open', direction });
    }

    if (!symbol) {
        return abortTrade(log, 'openPosition', 'missingSymbol', {}, { assetKey, symbol, action: 'open', direction });
    }

    const qty = toFiniteNumber(quantity);
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
        referencePrice = ensureOrderPrice(price ?? metadata.referencePrice, type);
    } catch (err) {
        return abortTrade(log, 'openPosition', 'invalidPrice', { message: err.message }, {
            assetKey,
            symbol,
            action: 'open',
            direction,
            quantity: qty,
        });
    }

    if (referencePrice === null && tradingCfg.minNotional > 0) {
        return abortTrade(log, 'openPosition', 'missingPrice', {}, {
            assetKey,
            symbol,
            action: 'open',
            direction,
            quantity: qty,
        });
    }

    const notional = referencePrice !== null ? qty * referencePrice : null;
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
        });
    }

    const maxNotional = computeMaxNotionalLimit(tradingCfg);
    if (maxNotional !== null && notional !== null && notional > maxNotional) {
        return abortTrade(log, 'openPosition', 'exceedsRiskLimit', {
            notional,
            maxNotional,
        }, {
            assetKey,
            symbol,
            action: 'open',
            direction,
            quantity: qty,
            price: referencePrice,
            notional,
        });
    }

    const side = direction === 'short' ? 'SELL' : 'BUY';
    const orderParams = buildOrderParams(params);

    try {
        const order = await submitOrder({
            symbol,
            side,
            type,
            quantity: qty,
            price: type === 'MARKET' ? undefined : referencePrice,
            params: orderParams,
        }, { context: { asset: assetKey ?? symbol, direction: side } });
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
                assetKey,
                symbol,
                action: 'open',
                status: 'executed',
                side,
                quantity: qty,
                price: order.fillPrice ?? referencePrice,
                notional,
                orderId: order.orderId,
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
                assetKey,
                symbol,
                action: 'open',
                status: 'error',
                side,
                quantity: qty,
                price: referencePrice,
                notional,
                reason: err.message,
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

    if (!tradingCfg.enabled) {
        return abortTrade(log, 'closePosition', 'disabled', {}, { assetKey, symbol, action: 'close', direction });
    }

    if (!symbol) {
        return abortTrade(log, 'closePosition', 'missingSymbol', {}, { assetKey, symbol, action: 'close', direction });
    }

    const qty = toFiniteNumber(quantity);
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
        referencePrice = ensureOrderPrice(price ?? metadata.referencePrice, type);
    } catch (err) {
        return abortTrade(log, 'closePosition', 'invalidPrice', { message: err.message }, {
            assetKey,
            symbol,
            action: 'close',
            direction,
            quantity: qty,
        });
    }

    const notional = referencePrice !== null ? qty * referencePrice : null;
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
        });
    }

    const side = direction === 'short' ? 'BUY' : 'SELL';
    const orderParams = buildOrderParams({ reduceOnly: true, ...params });

    try {
        const order = await submitOrder({
            symbol,
            side,
            type,
            quantity: qty,
            price: type === 'MARKET' ? undefined : referencePrice,
            params: orderParams,
        }, { context: { asset: assetKey ?? symbol, direction: side, intent: 'close' } });
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
                assetKey,
                symbol,
                action: 'close',
                status: 'executed',
                side,
                quantity: qty,
                price: order.fillPrice ?? referencePrice,
                notional,
                orderId: order.orderId,
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
                assetKey,
                symbol,
                action: 'close',
                status: 'error',
                side,
                quantity: qty,
                price: referencePrice,
                notional,
                reason: err.message,
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
            const response = await transferMargin({ asset: resolvedAsset, amount: fallbackAmount, direction: 'toMargin' });
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
            const response = await transferMargin({ asset: resolvedAsset, amount: fallbackAmount, direction: 'toSpot' });
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
            const response = await borrowMargin({ asset: resolvedAsset, amount: fallbackAmount });
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
            const response = await repayMargin({ asset: resolvedAsset, amount: fallbackAmount });
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
