/**
 * Simulador de crescimento de portfólio focado na meta 100€ → 10M€.
 *
 * O módulo roda backtests longos com rebalanceamento periódico, controles de risco e
 * geração de dashboards (`reports/portfolio/`), permitindo comparar estratégias com
 * os mesmos parâmetros expostos via configuração e comandos Discord.
 */

import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { ASSETS } from "../assets.js";
import { CFG } from "../config.js";
import { fetchDailyCloses } from "../data/binance.js";
import { renderPortfolioGrowthChart } from "../chart.js";
import { logger, withContext } from "../logger.js";
import { buildPortfolioGrowthDiscordMessage } from "./growthSummary.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const ensureDirectory = (dirPath) => {
    if (!dirPath) {
        return;
    }
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
};

const clamp = (value, min, max) => {
    if (!Number.isFinite(value)) {
        return min;
    }
    if (min !== undefined && value < min) {
        return min;
    }
    if (max !== undefined && value > max) {
        return max;
    }
    return value;
};

const computeStdDev = (values) => {
    const series = Array.isArray(values) ? values.filter(Number.isFinite) : [];
    if (series.length < 2) {
        return 0;
    }
    const mean = series.reduce((sum, value) => sum + value, 0) / series.length;
    const variance = series.reduce((sum, value) => {
        const diff = value - mean;
        return sum + diff * diff;
    }, 0) / (series.length - 1);
    return Math.sqrt(Math.max(variance, 0));
};

const buildEqualWeights = (assetKeys) => {
    if (!Array.isArray(assetKeys) || assetKeys.length === 0) {
        return {};
    }
    const weight = 1 / assetKeys.length;
    return Object.fromEntries(assetKeys.map((key) => [key, weight]));
};

const computeDynamicWeights = ({ baseWeights, returnsHistory, risk, assetKeys, strategy }) => {
    const weights = {};
    let baseSum = 0;
    for (const key of assetKeys) {
        const weight = Number.isFinite(baseWeights?.[key]) ? Math.max(baseWeights[key], 0) : 0;
        if (weight > 0) {
            weights[key] = weight;
            baseSum += weight;
        }
    }
    if (baseSum <= 0) {
        Object.assign(weights, buildEqualWeights(assetKeys));
        baseSum = 1;
    } else {
        for (const key of Object.keys(weights)) {
            weights[key] /= baseSum;
        }
    }

    const lookback = Math.max(5, Math.trunc(risk?.volatilityLookback ?? 30));
    const targetVol = Math.max(0.0001, risk?.volatilityTargetPct ?? 0.15);
    let adjustedSum = 0;
    for (const key of assetKeys) {
        const returns = returnsHistory.get(key) ?? [];
        const window = returns.slice(-lookback);
        const vol = computeStdDev(window);
        let modifier = 1;
        if (Number.isFinite(vol) && vol > 0) {
            modifier = clamp(targetVol / vol, 0.2, 1.5);
        }
        const baseWeight = weights[key] ?? 0;
        const adjusted = baseWeight * modifier;
        weights[key] = adjusted;
        adjustedSum += adjusted;
    }

    if (adjustedSum <= 0) {
        Object.assign(weights, buildEqualWeights(assetKeys));
        adjustedSum = 1;
    } else {
        for (const key of Object.keys(weights)) {
            weights[key] = weights[key] / adjustedSum;
        }
    }

    const minAllocation = Number.isFinite(strategy?.minAllocationPct) ? Math.max(strategy.minAllocationPct, 0) : 0;
    const maxAllocation = Number.isFinite(strategy?.maxAllocationPct) ? clamp(strategy.maxAllocationPct, minAllocation, 1) : 1;

    let boundedSum = 0;
    for (const key of Object.keys(weights)) {
        if (weights[key] <= 0) {
            weights[key] = 0;
            continue;
        }
        let bounded = weights[key];
        if (bounded > 0 && bounded < minAllocation) {
            bounded = minAllocation;
        }
        if (bounded > maxAllocation) {
            bounded = maxAllocation;
        }
        weights[key] = bounded;
        boundedSum += bounded;
    }

    if (boundedSum > 0) {
        for (const key of Object.keys(weights)) {
            weights[key] = weights[key] / boundedSum;
        }
    }

    return weights;
};

const rebalancePortfolio = ({
    timestamp,
    positions,
    cash,
    prices,
    weights,
    slippage,
    tolerance,
    maxPositionPct,
    reason,
    logTrade,
}) => {
    const validAssets = Object.entries(prices).filter(([, price]) => Number.isFinite(price) && price > 0);
    if (validAssets.length === 0) {
        return { executed: false, cash, investedValue: 0, totalValue: cash, weights: {} };
    }

    const totalInvested = validAssets.reduce((sum, [asset]) => {
        const position = positions.get(asset);
        return sum + (position ? (position.units ?? 0) * (prices[asset] ?? 0) : 0);
    }, 0);
    const totalValue = totalInvested + cash;

    const toleranceValue = Math.max(totalValue * tolerance, totalValue * 0.001);
    const normalized = {};
    let weightSum = 0;
    for (const [asset] of validAssets) {
        const weight = Number.isFinite(weights?.[asset]) ? Math.max(weights[asset], 0) : 0;
        normalized[asset] = weight;
        weightSum += weight;
    }

    if (weightSum <= 0) {
        const equal = 1 / validAssets.length;
        for (const [asset] of validAssets) {
            normalized[asset] = equal;
        }
        weightSum = 1;
    } else {
        for (const asset of Object.keys(normalized)) {
            normalized[asset] = normalized[asset] / weightSum;
        }
    }

    if (Number.isFinite(maxPositionPct) && maxPositionPct > 0 && maxPositionPct < 1) {
        let adjusted = false;
        for (const asset of Object.keys(normalized)) {
            if (normalized[asset] > maxPositionPct) {
                normalized[asset] = maxPositionPct;
                adjusted = true;
            }
        }
        if (adjusted) {
            const sum = Object.values(normalized).reduce((acc, value) => acc + value, 0);
            if (sum > 0) {
                for (const asset of Object.keys(normalized)) {
                    normalized[asset] = normalized[asset] / sum;
                }
            }
        }
    }

    let nextCash = cash;
    let investedValue = 0;
    let executed = false;

    const rebalanceReason = typeof reason === "string" && reason.length > 0
        ? reason
        : (timestamp === null ? "initial_allocation" : "rebalance");

    const recordTrade = ({ asset, action, quantity, price, reason: tradeReason }) => {
        if (typeof logTrade !== "function") {
            return;
        }
        const normalizedAsset = typeof asset === "string" ? asset.toUpperCase() : asset;
        const normalizedAction = typeof action === "string" ? action.toUpperCase() : action;
        const normalizedQuantity = Number(quantity);
        const normalizedPrice = Number(price);
        if (!normalizedAsset || !normalizedAction || !Number.isFinite(normalizedQuantity) || normalizedQuantity <= 0 || !Number.isFinite(normalizedPrice) || normalizedPrice <= 0) {
            return;
        }
        logTrade({
            timestamp,
            asset: normalizedAsset,
            action: normalizedAction,
            quantity: normalizedQuantity,
            price: normalizedPrice,
            value: normalizedQuantity * normalizedPrice,
            reason: tradeReason ?? rebalanceReason,
        });
    };

    for (const [asset, price] of validAssets) {
        const targetValue = (normalized[asset] ?? 0) * totalValue;
        const existing = positions.get(asset) ?? {
            units: 0,
            entryPrice: price,
            lastPrice: price,
            peakValue: 0,
            lastValue: 0,
        };
        const currentValue = (existing.units ?? 0) * price;
        const diff = targetValue - currentValue;
        const threshold = toleranceValue;

        if (Math.abs(diff) <= threshold) {
            existing.lastPrice = price;
            existing.lastValue = currentValue;
            if (currentValue > existing.peakValue) {
                existing.peakValue = currentValue;
            }
            positions.set(asset, existing);
            investedValue += currentValue;
            continue;
        }

        if (diff > 0) {
            const required = diff * (1 + slippage);
            if (required <= 0 || nextCash <= 0) {
                existing.lastPrice = price;
                existing.lastValue = currentValue;
                investedValue += currentValue;
                positions.set(asset, existing);
                continue;
            }
            const spend = Math.min(required, nextCash);
            const unitsToBuy = spend / ((1 + slippage) * price);
            if (unitsToBuy > 0) {
                const prevUnits = existing.units ?? 0;
                const newUnits = prevUnits + unitsToBuy;
                const prevCost = prevUnits * (existing.entryPrice ?? price);
                const newCost = unitsToBuy * price;
                existing.units = newUnits;
                existing.entryPrice = newUnits > 0 ? (prevCost + newCost) / newUnits : price;
                existing.lastPrice = price;
                existing.lastValue = newUnits * price;
                if (existing.lastValue > existing.peakValue) {
                    existing.peakValue = existing.lastValue;
                }
                positions.set(asset, existing);
                nextCash -= spend;
                investedValue += existing.lastValue;
                executed = true;
                recordTrade({
                    asset,
                    action: "buy",
                    quantity: unitsToBuy,
                    price: price * (1 + slippage),
                });
            } else {
                investedValue += currentValue;
            }
        } else {
            const valueToSell = Math.min(currentValue, Math.abs(diff));
            if (valueToSell > 0) {
                const unitsToSell = valueToSell / price;
                const remainingUnits = Math.max(0, (existing.units ?? 0) - unitsToSell);
                const proceeds = valueToSell * (1 - slippage);
                nextCash += proceeds;
                existing.units = remainingUnits;
                existing.lastPrice = price;
                existing.lastValue = remainingUnits * price;
                if (remainingUnits <= 0) {
                    positions.delete(asset);
                } else {
                    if (existing.lastValue > existing.peakValue) {
                        existing.peakValue = existing.lastValue;
                    }
                    existing.entryPrice = price;
                    positions.set(asset, existing);
                    investedValue += existing.lastValue;
                }
                executed = true;
                recordTrade({
                    asset,
                    action: "sell",
                    quantity: unitsToSell,
                    price: price * (1 - slippage),
                });
            } else {
                investedValue += currentValue;
                existing.lastPrice = price;
                existing.lastValue = currentValue;
                positions.set(asset, existing);
            }
        }
    }

    for (const [asset, position] of positions) {
        if (!Number.isFinite(prices[asset]) || prices[asset] <= 0 || !(asset in normalized)) {
            positions.delete(asset);
        } else if ((position.units ?? 0) <= 0) {
            positions.delete(asset);
        }
    }

    return {
        executed,
        cash: nextCash,
        investedValue,
        totalValue: nextCash + investedValue,
        weights: normalized,
        reason: rebalanceReason,
    };
};

const checkAllocationDrift = ({ positions, prices, totalValue, weights, tolerance }) => {
    if (!Number.isFinite(totalValue) || totalValue <= 0) {
        return false;
    }
    const threshold = Math.max(totalValue * tolerance, totalValue * 0.001);
    for (const [asset, position] of positions) {
        const price = prices[asset];
        if (!Number.isFinite(price) || price <= 0) {
            continue;
        }
        const currentValue = (position.units ?? 0) * price;
        const targetValue = (weights[asset] ?? 0) * totalValue;
        const deviation = Math.abs(currentValue - targetValue);
        if (deviation > threshold) {
            return true;
        }
    }
    return false;
};

export async function runPortfolioGrowthSimulation({ assets = ASSETS, config = CFG.portfolioGrowth } = {}) {
    if (!config?.enabled) {
        return null;
    }

    const start = performance.now();
    const log = withContext(logger, { fn: "runPortfolioGrowthSimulation" });

    const assetList = Array.isArray(assets) && assets.length > 0 ? assets : ASSETS;
    const historyDays = Math.max(30, Math.min(config.simulation?.historyDays ?? 365, 3650));

    const results = await Promise.all(assetList.map(async (asset) => {
        try {
            const candles = await fetchDailyCloses(asset.binance, historyDays + 1);
            return { asset, candles };
        } catch (error) {
            log.warn({ asset: asset.key, err: error }, "Failed to load daily closes for portfolio simulation");
            return { asset, candles: [] };
        }
    }));

    const seriesByAsset = new Map();
    const timelineSet = new Set();
    for (const { asset, candles } of results) {
        const normalized = Array.isArray(candles)
            ? candles
                .map((entry) => {
                    const time = entry?.t instanceof Date
                        ? entry.t.getTime()
                        : Number.isFinite(entry?.t)
                            ? Number(entry.t)
                            : Date.parse(entry?.t ?? "");
                    const close = Number.parseFloat(entry?.c ?? entry?.close ?? NaN);
                    if (!Number.isFinite(time) || !Number.isFinite(close)) {
                        return null;
                    }
                    return { time, close };
                })
                .filter(Boolean)
                .sort((a, b) => a.time - b.time)
            : [];
        if (normalized.length > 1) {
            seriesByAsset.set(asset.key, normalized);
            normalized.forEach((point) => timelineSet.add(point.time));
        }
    }

    const assetKeys = results
        .map(({ asset }) => asset.key)
        .filter((key) => seriesByAsset.has(key));

    if (assetKeys.length === 0) {
        log.warn({ fn: "runPortfolioGrowthSimulation" }, "No asset series available for growth simulation");
        return null;
    }

    const sortedTimeline = Array.from(timelineSet).sort((a, b) => a - b);
    if (sortedTimeline.length < 2) {
        log.warn({ fn: "runPortfolioGrowthSimulation" }, "Insufficient history for portfolio simulation");
        return null;
    }

    const minStart = Math.max(...assetKeys.map((key) => seriesByAsset.get(key)?.[0]?.time ?? -Infinity));
    const timeline = sortedTimeline.filter((time) => time >= minStart);
    if (timeline.length < 2) {
        log.warn({ fn: "runPortfolioGrowthSimulation" }, "Timeline collapsed after aligning asset histories");
        return null;
    }

    const baseStrategy = config.strategies?.default ?? {};
    const baseWeights = {};
    let weightSum = 0;
    for (const [asset, weight] of Object.entries(baseStrategy.allocation ?? {})) {
        const key = asset.toUpperCase();
        if (!assetKeys.includes(key)) {
            continue;
        }
        const parsed = Number.parseFloat(weight);
        if (Number.isFinite(parsed) && parsed > 0) {
            baseWeights[key] = parsed;
            weightSum += parsed;
        }
    }
    if (weightSum > 0) {
        for (const key of Object.keys(baseWeights)) {
            baseWeights[key] = baseWeights[key] / weightSum;
        }
    } else {
        Object.assign(baseWeights, buildEqualWeights(assetKeys));
    }

    const iterators = new Map();
    for (const key of assetKeys) {
        iterators.set(key, { data: seriesByAsset.get(key), index: 0, last: null });
    }

    const positions = new Map();
    const returnsHistory = new Map();
    const history = [];
    const trades = [];
    const portfolioReturns = [];
    const rebalances = [];
    let cash = Math.max(0, Number(config.initialCapital) || 0);
    let contributionsTotal = 0;
    let contributionsCount = 0;
    let portfolioHigh = cash;
    let maxDrawdownPct = 0;
    let targetReachedAt = null;
    let lastTotalValue = cash;

    const contributionInterval = Math.max(1, Math.trunc(config.simulation?.contribution?.intervalDays ?? 30));
    const contributionAmount = Math.max(0, Number(config.simulation?.contribution?.amount) || 0);
    const slippage = Math.max(0, Math.min(Number(config.simulation?.slippagePct) || 0, 0.05));
    const tolerance = Math.max(0, Number(config.rebalance?.tolerancePct) || 0.05);
    const rebalanceInterval = Math.max(1, Math.trunc(config.rebalance?.intervalDays ?? 30));
    const risk = config.risk ?? {};
    const strategy = {
        name: typeof baseStrategy?.name === "string" ? baseStrategy.name : "Default",
        minAllocationPct: Number(baseStrategy?.minAllocationPct),
        maxAllocationPct: Number(baseStrategy?.maxAllocationPct),
    };

    const pushTrade = ({ timestamp: tradeTimestamp, asset, action, quantity, price, value, reason }) => {
        const isoTimestamp = Number.isFinite(tradeTimestamp)
            ? new Date(tradeTimestamp).toISOString()
            : (tradeTimestamp instanceof Date ? tradeTimestamp.toISOString() : new Date().toISOString());
        trades.push({
            timestamp: isoTimestamp,
            asset,
            action,
            quantity,
            price,
            value,
            reason,
        });
    };

    for (let idx = 0; idx < timeline.length; idx += 1) {
        const timestamp = timeline[idx];

        if (idx > 0 && contributionAmount > 0 && contributionInterval > 0 && idx % contributionInterval === 0) {
            cash += contributionAmount;
            contributionsTotal += contributionAmount;
            contributionsCount += 1;
        }

        const prices = {};
        for (const key of assetKeys) {
            const iterator = iterators.get(key);
            while (iterator.index < iterator.data.length && iterator.data[iterator.index].time <= timestamp) {
                iterator.last = iterator.data[iterator.index];
                iterator.index += 1;
            }
            if (iterator.last) {
                prices[key] = iterator.last.close;
                const position = positions.get(key);
                if (position) {
                    const prevPrice = position.lastPrice;
                    if (Number.isFinite(prevPrice) && prevPrice > 0) {
                        const dailyReturn = (iterator.last.close / prevPrice) - 1;
                        if (Number.isFinite(dailyReturn)) {
                            const returns = returnsHistory.get(key) ?? [];
                            returns.push(dailyReturn);
                            if (returns.length > (risk.volatilityLookback ?? 30) * 4) {
                                returns.shift();
                            }
                            returnsHistory.set(key, returns);
                        }
                    }
                    position.lastPrice = iterator.last.close;
                    position.lastValue = position.units * iterator.last.close;
                    if (position.lastValue > position.peakValue) {
                        position.peakValue = position.lastValue;
                    }
                    const entryPrice = position.entryPrice || iterator.last.close;
                    const changePct = entryPrice > 0 ? (iterator.last.close - entryPrice) / entryPrice : 0;
                    const drawdownPct = position.peakValue > 0
                        ? 1 - (position.lastValue / position.peakValue)
                        : 0;
                    if (risk.stopLossPct > 0 && changePct <= -risk.stopLossPct) {
                        const unitsToSell = position.units ?? 0;
                        if (unitsToSell > 0) {
                            const executedPrice = iterator.last.close * (1 - slippage);
                            cash += position.lastValue * (1 - slippage);
                            pushTrade({
                                timestamp,
                                asset: key,
                                action: "SELL",
                                quantity: unitsToSell,
                                price: executedPrice,
                                value: unitsToSell * executedPrice,
                                reason: "stop_loss",
                            });
                        }
                        positions.delete(key);
                    } else if (risk.takeProfitPct > 0 && changePct >= risk.takeProfitPct && position.units > 0) {
                        const sellValue = position.lastValue * 0.5;
                        const unitsToSell = sellValue / iterator.last.close;
                        position.units = Math.max(0, position.units - unitsToSell);
                        cash += sellValue * (1 - slippage);
                        position.entryPrice = iterator.last.close;
                        position.lastValue = position.units * iterator.last.close;
                        position.peakValue = Math.max(position.peakValue, position.lastValue);
                        positions.set(key, position);
                        if (unitsToSell > 0) {
                            const executedPrice = iterator.last.close * (1 - slippage);
                            pushTrade({
                                timestamp,
                                asset: key,
                                action: "SELL",
                                quantity: unitsToSell,
                                price: executedPrice,
                                value: unitsToSell * executedPrice,
                                reason: "take_profit",
                            });
                        }
                    } else if (risk.maxDrawdownPct > 0 && drawdownPct >= risk.maxDrawdownPct) {
                        const unitsToSell = position.units ?? 0;
                        if (unitsToSell > 0) {
                            const executedPrice = iterator.last.close * (1 - slippage);
                            cash += position.lastValue * (1 - slippage);
                            pushTrade({
                                timestamp,
                                asset: key,
                                action: "SELL",
                                quantity: unitsToSell,
                                price: executedPrice,
                                value: unitsToSell * executedPrice,
                                reason: "max_drawdown",
                            });
                        }
                        positions.delete(key);
                    }
                }
            }
        }

        let invested = 0;
        for (const position of positions.values()) {
            invested += Number.isFinite(position.lastValue) ? position.lastValue : 0;
        }
        let totalValue = cash + invested;

        if (idx > 0 && Number.isFinite(totalValue) && Number.isFinite(lastTotalValue) && lastTotalValue > 0) {
            const portfolioReturn = (totalValue / lastTotalValue) - 1;
            if (Number.isFinite(portfolioReturn)) {
                portfolioReturns.push(portfolioReturn);
            }
        }

        if (Number.isFinite(totalValue) && totalValue > portfolioHigh) {
            portfolioHigh = totalValue;
        }
        const drawdown = portfolioHigh > 0 ? 1 - (totalValue / portfolioHigh) : 0;
        if (drawdown > maxDrawdownPct) {
            maxDrawdownPct = drawdown;
        }

        const record = {
            timestamp: new Date(timestamp).toISOString(),
            totalValue,
            cash,
            invested,
            drawdownPct: drawdown,
            contributionsTotal,
        };
        history.push(record);

        if (!targetReachedAt && totalValue >= config.targetCapital) {
            targetReachedAt = timestamp;
        }

        const dynamicWeights = computeDynamicWeights({
            baseWeights,
            returnsHistory,
            risk,
            assetKeys,
            strategy,
        });

        const driftDetected = checkAllocationDrift({
            positions,
            prices,
            totalValue,
            weights: dynamicWeights,
            tolerance,
        });

        if (idx === 0 || (rebalanceInterval > 0 && idx % rebalanceInterval === 0) || driftDetected) {
            const rebalanceReason = idx === 0
                ? "initial_allocation"
                : (driftDetected ? "drift_rebalance" : "interval_rebalance");
            const result = rebalancePortfolio({
                timestamp,
                positions,
                cash,
                prices,
                weights: dynamicWeights,
                slippage,
                tolerance,
                maxPositionPct: risk.maxPositionPct,
                reason: rebalanceReason,
                logTrade: pushTrade,
            });
            cash = result.cash;
            invested = result.investedValue;
            totalValue = result.totalValue;
            record.cash = cash;
            record.invested = invested;
            record.totalValue = totalValue;
            if (result.executed) {
                rebalances.push({
                    timestamp: new Date(timestamp).toISOString(),
                    reason: idx === 0 ? "initial" : (driftDetected ? "drift" : "interval"),
                    totalValue: result.totalValue,
                    weights: result.weights,
                });
            }
        }

        lastTotalValue = totalValue;
    }

    const startTime = timeline[0];
    const endTime = timeline[timeline.length - 1];
    const durationDays = (endTime - startTime) / DAY_MS;
    const years = durationDays > 0 ? durationDays / 365 : 0;
    const investedCapital = Math.max(0, config.initialCapital) + contributionsTotal;
    const finalValue = lastTotalValue;
    const totalReturnPct = investedCapital > 0 ? (finalValue - investedCapital) / investedCapital : 0;
    const cagr = years > 0 && investedCapital > 0 && finalValue > 0
        ? Math.pow(finalValue / investedCapital, 1 / years) - 1
        : 0;
    const dailyStd = computeStdDev(portfolioReturns);
    const annualizedVolatility = dailyStd * Math.sqrt(365);
    const avgDailyReturn = portfolioReturns.length > 0
        ? portfolioReturns.reduce((sum, value) => sum + value, 0) / portfolioReturns.length
        : 0;
    const riskFreeDaily = Math.pow(1 + (config.simulation?.riskFreeRate ?? 0.02), 1 / 365) - 1;
    const sharpeRatio = dailyStd > 0
        ? ((avgDailyReturn - riskFreeDaily) / dailyStd) * Math.sqrt(365)
        : 0;

    const targetCapital = Math.max(0, Number(config.targetCapital) || 0);
    const progressPct = targetCapital > 0 && Number.isFinite(finalValue)
        ? finalValue / targetCapital
        : 0;
    let estimatedYearsToTarget = null;
    if (!targetReachedAt && targetCapital > 0 && finalValue > 0 && cagr > 0) {
        const ratio = targetCapital / finalValue;
        if (ratio > 1) {
            const numerator = Math.log(ratio);
            const denominator = Math.log(1 + cagr);
            if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0) {
                estimatedYearsToTarget = numerator / denominator;
            }
        }
    }

    const summary = {
        runAt: new Date().toISOString(),
        strategy: strategy.name,
        assets: assetKeys,
        initialCapital: config.initialCapital,
        contributionsTotal,
        contributionsCount,
        investedCapital,
        finalValue,
        targetCapital,
        targetReached: targetReachedAt != null,
        targetReachedAt: targetReachedAt ? new Date(targetReachedAt).toISOString() : null,
        metrics: {
            totalReturnPct,
            cagr,
            maxDrawdownPct,
            durationDays,
            durationYears: years,
            annualizedVolatility,
            sharpeRatio,
            rebalances: rebalances.length,
            avgDailyReturn,
        },
        history,
        rebalances,
        uploads: [],
        reports: {},
        runtimeMs: performance.now() - start,
    };

    summary.progress = {
        pct: Number.isFinite(progressPct) ? progressPct : 0,
        remainingCapital: Math.max(0, targetCapital - finalValue),
        estimatedYearsToTarget: Number.isFinite(estimatedYearsToTarget) && estimatedYearsToTarget > 0
            ? estimatedYearsToTarget
            : null,
    };

    summary.trades = trades;

    const discordMessage = buildPortfolioGrowthDiscordMessage({
        summary,
        mention: config.discord?.mention,
        locale: config.discord?.locale,
        includeReportLinks: config.discord?.includeReportLinks !== false,
    });
    if (discordMessage?.message) {
        summary.discord = {
            message: discordMessage.message,
            attachments: discordMessage.attachments ?? [],
        };
        summary.discordMessage = discordMessage.message;
    }

    if (config.reporting?.enabled) {
        const reportDir = config.reporting.directory ?? "reports/growth";
        ensureDirectory(reportDir);
        const summaryPath = path.join(reportDir, "latest.json");
        const progressionPath = path.join(reportDir, "progression.json");
        const archivePath = path.join(reportDir, "runs.json");

        const persistedSummary = {
            ...summary,
            discord: summary.discord
                ? {
                    ...summary.discord,
                    attachments: Array.isArray(summary.discord.attachments)
                        ? summary.discord.attachments.map((attachment) => ({
                            filename: attachment.filename,
                            contentType: attachment.contentType,
                            size: attachment.size,
                        }))
                        : [],
                }
                : undefined,
        };

        fs.writeFileSync(summaryPath, `${JSON.stringify(persistedSummary, null, 2)}\n`);
        fs.writeFileSync(progressionPath, `${JSON.stringify({ runAt: summary.runAt, history }, null, 2)}\n`);

        let archive = [];
        if (fs.existsSync(archivePath)) {
            try {
                const raw = fs.readFileSync(archivePath, "utf-8");
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    archive = parsed;
                }
            } catch (error) {
                log.warn({ fn: "runPortfolioGrowthSimulation", err: error }, "Failed to read growth archive; resetting file");
                archive = [];
            }
        }
        archive.push({
            runAt: summary.runAt,
            finalValue,
            investedCapital,
            totalReturnPct,
            cagr,
            maxDrawdownPct,
            targetReached: summary.targetReached,
        });
        if (archive.length > 120) {
            archive = archive.slice(-120);
        }
        fs.writeFileSync(archivePath, `${JSON.stringify(archive, null, 2)}\n`);

        summary.reports = {
            summaryPath,
            progressionPath,
            archivePath,
        };

        if (history.length >= 2) {
            try {
                const chartPath = await renderPortfolioGrowthChart({
                    history,
                    targetCapital: config.targetCapital,
                    options: {
                        directory: config.reporting.chartDirectory ?? "charts/growth",
                        maxDrawdownPct,
                        cagr,
                    },
                });
                if (chartPath) {
                    summary.reports.chartPath = chartPath;
                    if (config.reporting.appendToUploads) {
                        summary.uploads.push(chartPath);
                    }
                }
            } catch (error) {
                log.warn({ fn: "runPortfolioGrowthSimulation", err: error }, "Failed to render portfolio growth chart");
            }
        }
    }

    log.info({
        fn: "runPortfolioGrowthSimulation",
        finalValue,
        totalReturnPct,
        cagr,
        sharpeRatio,
        maxDrawdownPct,
        runtimeMs: summary.runtimeMs,
    }, "Portfolio growth simulation completed");

    return summary;
}

