import "dotenv/config";
import { existsSync, readFileSync, watch } from "node:fs";
import { writeFile } from "node:fs/promises";
import { ASSETS } from "./assets.js";
import { logger, withContext } from "./logger.js";
import { DEFAULT_ALERT_MODULES } from "./alerts/registry.js";
import { loadSettings, getSetting, setSetting } from "./settings.js";

const DEFAULT_CONFIG_PATH = new URL('../config/default.json', import.meta.url);
const CUSTOM_CONFIG_PATH = new URL('../config/custom.json', import.meta.url);
const CONFIG_DIR_PATH = new URL('../config/', import.meta.url);

const WATCH_DEBOUNCE_MS = 250;

const clone = (value) => JSON.parse(JSON.stringify(value ?? {}));

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const deepMerge = (target, source) => {
    if (!isPlainObject(source)) {
        return target;
    }

    for (const [key, value] of Object.entries(source)) {
        if (Array.isArray(value)) {
            target[key] = value.slice();
        } else if (isPlainObject(value)) {
            if (!isPlainObject(target[key])) {
                target[key] = {};
            }
            deepMerge(target[key], value);
        } else {
            target[key] = value;
        }
    }

    return target;
};

let defaultConfig = {};
let customConfig = {};
let mergedConfig = {};
let skipNextWatchReload = false;
let watchTimeout;
let customFileWatcher;
let customDirWatcher;

const configListeners = new Set();

export const CFG = {};

const DEFAULT_BINANCE_CACHE_TTL_MINUTES_FALLBACK = 10;

const toNumber = (value, fallback) => {
    const parsed = Number.parseFloat(value ?? '');
    return Number.isFinite(parsed) ? parsed : fallback;
};

const toInt = (value, fallback) => {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const toNumberList = (value, fallback, expectedLength) => {
    if (!value) return fallback;
    const parsed = value
        .split(',')
        .map(part => Number.parseFloat(part.trim()))
        .filter(n => Number.isFinite(n));
    if (expectedLength && parsed.length < expectedLength) {
        return fallback;
    }
    return parsed.length ? parsed : fallback;
};

const toStringList = (value) => {
    return value
        ? value
            .split(',')
            .map(part => part.trim())
            .filter(Boolean)
        : [];
};

const toDailyReportHours = (value, fallback = ['8']) => {
    const parts = Array.isArray(value)
        ? value
        : typeof value === 'string'
            ? value.split(',')
            : value != null
                ? [value]
                : [];
    const normalized = parts
        .map((part) => {
            if (typeof part === 'number' && Number.isFinite(part)) {
                return Math.trunc(part);
            }
            if (typeof part === 'string') {
                const trimmed = part.trim();
                if (trimmed === '') {
                    return null;
                }
                const parsed = Number.parseInt(trimmed, 10);
                return Number.isFinite(parsed) ? parsed : null;
            }
            return null;
        })
        .filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23);

    const unique = Array.from(new Set(normalized));
    if (unique.length === 0) {
        return fallback.slice();
    }
    unique.sort((a, b) => a - b);
    return unique.map((hour) => String(hour));
};

const toBoolean = (value, fallback) => {
    if (value === undefined) {
        return fallback;
    }

    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'on'].includes(normalized)) {
            return true;
        }
        if (['false', '0', 'no', 'off'].includes(normalized)) {
            return false;
        }
    }

    return fallback;
};

const DEFAULT_MIN_PROFIT_CONFIG = { default: 0, users: {} };

const parseMinimumProfitValue = (value) => {
    if (value === undefined || value === null) {
        return null;
    }
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) {
        return null;
    }
    if (parsed < 0 || parsed > 1) {
        return null;
    }
    return parsed;
};

const normalizeMinimumProfitThreshold = (raw, fallback = DEFAULT_MIN_PROFIT_CONFIG) => {
    const base = isPlainObject(raw) ? raw : {};
    const normalized = {
        default: parseMinimumProfitValue(base.default)
            ?? parseMinimumProfitValue(fallback?.default)
            ?? DEFAULT_MIN_PROFIT_CONFIG.default,
        users: {},
    };

    const fallbackUsers = isPlainObject(fallback?.users) ? fallback.users : DEFAULT_MIN_PROFIT_CONFIG.users;
    for (const [userId, value] of Object.entries(fallbackUsers)) {
        const parsed = parseMinimumProfitValue(value);
        if (parsed !== null) {
            normalized.users[userId] = parsed;
        }
    }

    if (isPlainObject(base.users)) {
        for (const [userId, value] of Object.entries(base.users)) {
            const parsed = parseMinimumProfitValue(value);
            if (parsed !== null) {
                normalized.users[userId] = parsed;
            } else if (userId in normalized.users) {
                delete normalized.users[userId];
            }
        }
    }

    return normalized;
};

const DEFAULT_TRADING_MARGIN_CONFIG = {
    asset: "USDT",
    minFree: 0,
    transferAmount: 0,
};

const DEFAULT_TRADING_STRATEGY_CONFIG = {
    minimumConfidence: 0.35,
};

const DEFAULT_TRADING_CONFIG = {
    enabled: false,
    minNotional: 0,
    maxPositionPct: 0.1,
    maxLeverage: 1,
    maxSlippagePct: 0.005,
    margin: DEFAULT_TRADING_MARGIN_CONFIG,
    strategy: DEFAULT_TRADING_STRATEGY_CONFIG,
};

const DEFAULT_MARKET_POSTURE_CONFIG = {
    bullishMaRatio: 1.01,
    bearishMaRatio: 0.99,
    neutralBuffer: 0.003,
    minSlope: 0.0005,
    lookback: 5,
    minTrendStrength: 18,
    rsiBullish: 55,
    rsiBearish: 45,
};

const DEFAULT_FORECAST_CHART_CONFIG = {
    enabled: true,
    historyPoints: 120,
    directory: "charts/forecasts",
    appendToUploads: false,
};

const DEFAULT_FORECAST_CONFIG = {
    enabled: true,
    lookback: 48,
    minHistory: 72,
    historyLimit: 240,
    outputDir: "reports/forecasts",
    charts: DEFAULT_FORECAST_CHART_CONFIG,
};

const DEFAULT_PORTFOLIO_CONTRIBUTION_CONFIG = {
    amount: 100,
    intervalDays: 30,
};

const DEFAULT_PORTFOLIO_SIMULATION_CONFIG = {
    historyDays: 1095,
    riskFreeRate: 0.02,
    contribution: DEFAULT_PORTFOLIO_CONTRIBUTION_CONFIG,
    slippagePct: 0.001,
};

const DEFAULT_PORTFOLIO_REBALANCE_CONFIG = {
    intervalDays: 30,
    tolerancePct: 0.05,
};

const DEFAULT_PORTFOLIO_RISK_CONFIG = {
    maxDrawdownPct: 0.35,
    stopLossPct: 0.12,
    takeProfitPct: 0.25,
    maxPositionPct: 0.4,
    volatilityLookback: 30,
    volatilityTargetPct: 0.15,
};

const DEFAULT_PORTFOLIO_REPORTING_CONFIG = {
    enabled: true,
    directory: "reports/growth",
    chartDirectory: "charts/growth",
    appendToUploads: false,
};

const DEFAULT_PORTFOLIO_DISCORD_CONFIG = {
    enabled: false,
    mention: "",
    webhookUrl: "",
    channelId: "",
    locale: "pt-PT",
    includeReportLinks: true,
};

const DEFAULT_PORTFOLIO_STRATEGY_CONFIG = {
    name: "Base Rebalance",
    allocation: {},
    minAllocationPct: 0,
    maxAllocationPct: 0.6,
};

const DEFAULT_PORTFOLIO_GROWTH_CONFIG = {
    enabled: false,
    initialCapital: 100,
    targetCapital: 10_000_000,
    simulation: DEFAULT_PORTFOLIO_SIMULATION_CONFIG,
    rebalance: DEFAULT_PORTFOLIO_REBALANCE_CONFIG,
    risk: DEFAULT_PORTFOLIO_RISK_CONFIG,
    reporting: DEFAULT_PORTFOLIO_REPORTING_CONFIG,
    discord: DEFAULT_PORTFOLIO_DISCORD_CONFIG,
    strategies: {
        default: DEFAULT_PORTFOLIO_STRATEGY_CONFIG,
    },
};

const clampNumber = (value, fallback, { min, max } = {}) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }
    if (min !== undefined && value < min) {
        return fallback;
    }
    if (max !== undefined && value > max) {
        return fallback;
    }
    return value;
};

const parseAllocationPairs = (value) => {
    if (typeof value !== "string" || value.trim() === "") {
        return null;
    }
    const allocation = {};
    const parts = value.split(",");
    for (const part of parts) {
        if (!part) continue;
        const [symbolPart, weightPart] = part.split(/[:=]/);
        const symbol = symbolPart?.trim()?.toUpperCase?.();
        const weight = Number.parseFloat(weightPart ?? "");
        if (symbol && Number.isFinite(weight) && weight > 0) {
            allocation[symbol] = weight;
        }
    }
    return Object.keys(allocation).length > 0 ? allocation : null;
};

const normalizeAllocation = (allocation) => {
    const base = isPlainObject(allocation) ? allocation : {};
    const weights = [];
    for (const [asset, rawWeight] of Object.entries(base)) {
        const parsed = Number.parseFloat(rawWeight);
        if (Number.isFinite(parsed) && parsed > 0) {
            weights.push([asset.toUpperCase(), parsed]);
        }
    }
    if (weights.length === 0) {
        return {};
    }
    const total = weights.reduce((sum, [, weight]) => sum + weight, 0);
    if (!Number.isFinite(total) || total <= 0) {
        return {};
    }
    const normalized = {};
    for (const [asset, weight] of weights) {
        normalized[asset] = weight / total;
    }
    return normalized;
};

const buildTradingConfig = (baseConfig = {}) => {
    const base = isPlainObject(baseConfig) ? baseConfig : {};
    const config = {
        ...DEFAULT_TRADING_CONFIG,
        ...base,
        margin: {
            ...DEFAULT_TRADING_MARGIN_CONFIG,
            ...(isPlainObject(base.margin) ? base.margin : {}),
        },
        strategy: {
            ...DEFAULT_TRADING_STRATEGY_CONFIG,
            ...(isPlainObject(base.strategy) ? base.strategy : {}),
        },
    };

    config.enabled = toBoolean(process.env.TRADING_ENABLED, config.enabled);

    const minNotional = toNumber(process.env.TRADING_MIN_NOTIONAL, config.minNotional);
    config.minNotional = clampNumber(minNotional, DEFAULT_TRADING_CONFIG.minNotional, { min: 0 });

    const maxPositionPct = toNumber(process.env.TRADING_MAX_POSITION_PCT, config.maxPositionPct);
    config.maxPositionPct = clampNumber(maxPositionPct, DEFAULT_TRADING_CONFIG.maxPositionPct, { min: 0.001, max: 1 });

    const maxLeverage = toNumber(process.env.TRADING_MAX_LEVERAGE, config.maxLeverage);
    config.maxLeverage = clampNumber(maxLeverage, DEFAULT_TRADING_CONFIG.maxLeverage, { min: 1, max: 125 });

    const maxSlippagePct = toNumber(process.env.TRADING_MAX_SLIPPAGE_PCT, config.maxSlippagePct);
    config.maxSlippagePct = clampNumber(maxSlippagePct, DEFAULT_TRADING_CONFIG.maxSlippagePct, { min: 0, max: 0.5 });

    const strategyConfidence = toNumber(
        process.env.TRADING_STRATEGY_MIN_CONFIDENCE,
        config.strategy.minimumConfidence,
    );
    config.strategy.minimumConfidence = clampNumber(
        strategyConfidence,
        DEFAULT_TRADING_STRATEGY_CONFIG.minimumConfidence,
        { min: 0, max: 1 },
    );

    const marginMinFree = toNumber(process.env.TRADING_MARGIN_MIN_FREE, config.margin.minFree);
    config.margin.minFree = clampNumber(marginMinFree, DEFAULT_TRADING_MARGIN_CONFIG.minFree, { min: 0 });

    const transferAmount = toNumber(process.env.TRADING_MARGIN_TRANSFER_AMOUNT, config.margin.transferAmount);
    config.margin.transferAmount = clampNumber(
        transferAmount,
        DEFAULT_TRADING_MARGIN_CONFIG.transferAmount,
        { min: 0 },
    );

    const marginAsset = process.env.TRADING_MARGIN_ASSET ?? config.margin.asset ?? DEFAULT_TRADING_MARGIN_CONFIG.asset;
    config.margin.asset = typeof marginAsset === "string" && marginAsset.trim() !== ""
        ? marginAsset.trim().toUpperCase()
        : DEFAULT_TRADING_MARGIN_CONFIG.asset;

    return config;
};

const buildMarketPostureConfig = (baseConfig = {}) => {
    const base = isPlainObject(baseConfig) ? baseConfig : {};
    const config = { ...DEFAULT_MARKET_POSTURE_CONFIG, ...base };

    const bullishRatio = toNumber(process.env.MARKET_POSTURE_BULLISH_RATIO, config.bullishMaRatio);
    config.bullishMaRatio = clampNumber(bullishRatio, DEFAULT_MARKET_POSTURE_CONFIG.bullishMaRatio, { min: 1 });

    const bearishRatio = toNumber(process.env.MARKET_POSTURE_BEARISH_RATIO, config.bearishMaRatio);
    config.bearishMaRatio = clampNumber(bearishRatio, DEFAULT_MARKET_POSTURE_CONFIG.bearishMaRatio, { min: 0, max: 1 });

    if (config.bullishMaRatio <= config.bearishMaRatio) {
        config.bullishMaRatio = DEFAULT_MARKET_POSTURE_CONFIG.bullishMaRatio;
        config.bearishMaRatio = DEFAULT_MARKET_POSTURE_CONFIG.bearishMaRatio;
    }

    const neutralBuffer = toNumber(process.env.MARKET_POSTURE_NEUTRAL_BUFFER, config.neutralBuffer);
    config.neutralBuffer = clampNumber(neutralBuffer, DEFAULT_MARKET_POSTURE_CONFIG.neutralBuffer, { min: 0 });

    const minSlope = toNumber(process.env.MARKET_POSTURE_MIN_SLOPE, config.minSlope);
    config.minSlope = clampNumber(minSlope, DEFAULT_MARKET_POSTURE_CONFIG.minSlope, { min: 0 });

    const lookback = toInt(process.env.MARKET_POSTURE_LOOKBACK, config.lookback);
    config.lookback = clampNumber(lookback, DEFAULT_MARKET_POSTURE_CONFIG.lookback, { min: 1, max: 500 });

    const minTrend = toNumber(process.env.MARKET_POSTURE_MIN_TREND, config.minTrendStrength);
    config.minTrendStrength = clampNumber(minTrend, DEFAULT_MARKET_POSTURE_CONFIG.minTrendStrength, { min: 0 });

    const rsiBullish = toNumber(process.env.MARKET_POSTURE_RSI_BULLISH, config.rsiBullish);
    config.rsiBullish = clampNumber(rsiBullish, DEFAULT_MARKET_POSTURE_CONFIG.rsiBullish, { min: 0, max: 100 });

    const rsiBearish = toNumber(process.env.MARKET_POSTURE_RSI_BEARISH, config.rsiBearish);
    config.rsiBearish = clampNumber(rsiBearish, DEFAULT_MARKET_POSTURE_CONFIG.rsiBearish, { min: 0, max: 100 });

    if (config.rsiBullish <= config.rsiBearish) {
        config.rsiBullish = DEFAULT_MARKET_POSTURE_CONFIG.rsiBullish;
        config.rsiBearish = DEFAULT_MARKET_POSTURE_CONFIG.rsiBearish;
    }

    return config;
};

const buildForecastConfig = (baseConfig = {}) => {
    const base = isPlainObject(baseConfig) ? baseConfig : {};
    const chartsBase = isPlainObject(base.charts) ? base.charts : {};
    const config = {
        ...DEFAULT_FORECAST_CONFIG,
        ...base,
        charts: {
            ...DEFAULT_FORECAST_CHART_CONFIG,
            ...chartsBase,
        },
    };

    config.enabled = toBoolean(process.env.FORECASTING_ENABLED, config.enabled);

    const lookback = toInt(process.env.FORECASTING_LOOKBACK, config.lookback);
    config.lookback = clampNumber(lookback, DEFAULT_FORECAST_CONFIG.lookback, { min: 5, max: 5000 });

    const minHistory = toInt(process.env.FORECASTING_MIN_HISTORY, config.minHistory);
    const minHistoryClamped = clampNumber(minHistory, config.minHistory, { min: config.lookback, max: 10000 });
    config.minHistory = Math.max(config.lookback, minHistoryClamped);

    const historyLimit = toInt(process.env.FORECASTING_HISTORY_LIMIT, config.historyLimit);
    config.historyLimit = clampNumber(historyLimit, config.historyLimit, { min: 10, max: 10000 });

    const outputDirEnv = process.env.FORECASTING_OUTPUT_DIR;
    if (typeof outputDirEnv === "string" && outputDirEnv.trim() !== "") {
        config.outputDir = outputDirEnv.trim();
    } else if (typeof config.outputDir !== "string" || config.outputDir.trim() === "") {
        config.outputDir = DEFAULT_FORECAST_CONFIG.outputDir;
    }

    config.charts.enabled = toBoolean(process.env.FORECASTING_CHARTS_ENABLED, config.charts.enabled);
    const chartHistory = toInt(process.env.FORECASTING_CHART_HISTORY, config.charts.historyPoints);
    config.charts.historyPoints = clampNumber(chartHistory, config.charts.historyPoints, { min: 10, max: 5000 });

    const chartDirEnv = process.env.FORECASTING_CHART_DIR;
    if (typeof chartDirEnv === "string" && chartDirEnv.trim() !== "") {
        config.charts.directory = chartDirEnv.trim();
    } else if (typeof config.charts.directory !== "string" || config.charts.directory.trim() === "") {
        config.charts.directory = DEFAULT_FORECAST_CHART_CONFIG.directory;
    }

    config.charts.appendToUploads = toBoolean(
        process.env.FORECASTING_CHART_ATTACH,
        config.charts.appendToUploads,
    );

    return config;
};

const buildPortfolioGrowthConfig = (baseConfig = {}) => {
    const base = isPlainObject(baseConfig) ? baseConfig : {};
    const defaults = clone(DEFAULT_PORTFOLIO_GROWTH_CONFIG);
    const config = {
        ...defaults,
        ...base,
        simulation: {
            ...defaults.simulation,
            ...(isPlainObject(base.simulation) ? base.simulation : {}),
            contribution: {
                ...defaults.simulation.contribution,
                ...(isPlainObject(base.simulation?.contribution) ? base.simulation.contribution : {}),
            },
        },
        rebalance: {
            ...defaults.rebalance,
            ...(isPlainObject(base.rebalance) ? base.rebalance : {}),
        },
        risk: {
            ...defaults.risk,
            ...(isPlainObject(base.risk) ? base.risk : {}),
        },
        reporting: {
            ...defaults.reporting,
            ...(isPlainObject(base.reporting) ? base.reporting : {}),
        },
        discord: {
            ...defaults.discord,
            ...(isPlainObject(base.discord) ? base.discord : {}),
        },
        strategies: {},
    };

    config.enabled = toBoolean(process.env.PORTFOLIO_GROWTH_ENABLED, config.enabled);

    const initialCapital = toNumber(process.env.PORTFOLIO_INITIAL_CAPITAL, config.initialCapital);
    config.initialCapital = clampNumber(initialCapital, config.initialCapital, { min: 0.01 });

    const targetCapital = toNumber(process.env.PORTFOLIO_TARGET_CAPITAL, config.targetCapital);
    config.targetCapital = clampNumber(targetCapital, config.targetCapital, { min: config.initialCapital });

    const historyDays = toInt(process.env.PORTFOLIO_HISTORY_DAYS, config.simulation.historyDays);
    config.simulation.historyDays = clampNumber(historyDays, config.simulation.historyDays, { min: 30, max: 3650 });

    const riskFreeRate = toNumber(process.env.PORTFOLIO_RISK_FREE_RATE, config.simulation.riskFreeRate);
    config.simulation.riskFreeRate = clampNumber(riskFreeRate, config.simulation.riskFreeRate, { min: 0, max: 1 });

    const contributionAmount = toNumber(process.env.PORTFOLIO_CONTRIBUTION_AMOUNT, config.simulation.contribution.amount);
    config.simulation.contribution.amount = clampNumber(contributionAmount, config.simulation.contribution.amount, { min: 0 });

    const contributionInterval = toInt(process.env.PORTFOLIO_CONTRIBUTION_INTERVAL, config.simulation.contribution.intervalDays);
    config.simulation.contribution.intervalDays = clampNumber(
        contributionInterval,
        config.simulation.contribution.intervalDays,
        { min: 1, max: 365 },
    );

    const slippagePct = toNumber(process.env.PORTFOLIO_SLIPPAGE_PCT, config.simulation.slippagePct);
    config.simulation.slippagePct = clampNumber(slippagePct, config.simulation.slippagePct, { min: 0, max: 0.05 });

    const rebalanceInterval = toInt(process.env.PORTFOLIO_REBALANCE_INTERVAL, config.rebalance.intervalDays);
    config.rebalance.intervalDays = clampNumber(rebalanceInterval, config.rebalance.intervalDays, { min: 1, max: 365 });

    const tolerancePct = toNumber(process.env.PORTFOLIO_REBALANCE_TOLERANCE, config.rebalance.tolerancePct);
    config.rebalance.tolerancePct = clampNumber(tolerancePct, config.rebalance.tolerancePct, { min: 0, max: 0.2 });

    const maxDrawdown = toNumber(process.env.PORTFOLIO_MAX_DRAWDOWN_PCT, config.risk.maxDrawdownPct);
    config.risk.maxDrawdownPct = clampNumber(maxDrawdown, config.risk.maxDrawdownPct, { min: 0.01, max: 0.9 });

    const stopLoss = toNumber(process.env.PORTFOLIO_STOP_LOSS_PCT, config.risk.stopLossPct);
    config.risk.stopLossPct = clampNumber(stopLoss, config.risk.stopLossPct, { min: 0.01, max: 0.9 });

    const takeProfit = toNumber(process.env.PORTFOLIO_TAKE_PROFIT_PCT, config.risk.takeProfitPct);
    config.risk.takeProfitPct = clampNumber(takeProfit, config.risk.takeProfitPct, { min: 0.05, max: 1 });

    const maxPosition = toNumber(process.env.PORTFOLIO_MAX_POSITION_PCT, config.risk.maxPositionPct);
    config.risk.maxPositionPct = clampNumber(maxPosition, config.risk.maxPositionPct, { min: 0.05, max: 1 });

    const volatilityLookback = toInt(process.env.PORTFOLIO_VOL_LOOKBACK, config.risk.volatilityLookback);
    config.risk.volatilityLookback = clampNumber(volatilityLookback, config.risk.volatilityLookback, { min: 5, max: 365 });

    const volatilityTarget = toNumber(process.env.PORTFOLIO_VOL_TARGET_PCT, config.risk.volatilityTargetPct);
    config.risk.volatilityTargetPct = clampNumber(volatilityTarget, config.risk.volatilityTargetPct, { min: 0.01, max: 1 });

    config.reporting.enabled = toBoolean(process.env.PORTFOLIO_REPORTING_ENABLED, config.reporting.enabled);

    const reportDirEnv = process.env.PORTFOLIO_REPORT_DIR;
    if (typeof reportDirEnv === "string" && reportDirEnv.trim() !== "") {
        config.reporting.directory = reportDirEnv.trim();
    } else if (typeof config.reporting.directory !== "string" || config.reporting.directory.trim() === "") {
        config.reporting.directory = DEFAULT_PORTFOLIO_REPORTING_CONFIG.directory;
    }

    const chartDirEnv = process.env.PORTFOLIO_CHART_DIR;
    if (typeof chartDirEnv === "string" && chartDirEnv.trim() !== "") {
        config.reporting.chartDirectory = chartDirEnv.trim();
    } else if (typeof config.reporting.chartDirectory !== "string" || config.reporting.chartDirectory.trim() === "") {
        config.reporting.chartDirectory = DEFAULT_PORTFOLIO_REPORTING_CONFIG.chartDirectory;
    }

    config.reporting.appendToUploads = toBoolean(
        process.env.PORTFOLIO_APPEND_UPLOADS,
        config.reporting.appendToUploads,
    );

    config.discord.enabled = toBoolean(process.env.PORTFOLIO_DISCORD_ENABLED, config.discord.enabled);
    if (typeof process.env.PORTFOLIO_DISCORD_WEBHOOK === "string") {
        const rawWebhook = process.env.PORTFOLIO_DISCORD_WEBHOOK.trim();
        config.discord.webhookUrl = rawWebhook !== "" ? rawWebhook : "";
    }
    if (typeof process.env.PORTFOLIO_DISCORD_CHANNEL === "string") {
        const rawChannel = process.env.PORTFOLIO_DISCORD_CHANNEL.trim();
        config.discord.channelId = rawChannel !== "" ? rawChannel : "";
    }
    if (typeof process.env.PORTFOLIO_DISCORD_MENTION === "string") {
        config.discord.mention = process.env.PORTFOLIO_DISCORD_MENTION.trim();
    }
    if (typeof process.env.PORTFOLIO_DISCORD_LOCALE === "string") {
        const locale = process.env.PORTFOLIO_DISCORD_LOCALE.trim();
        config.discord.locale = locale !== "" ? locale : config.discord.locale;
    }
    config.discord.includeReportLinks = toBoolean(
        process.env.PORTFOLIO_DISCORD_INCLUDE_REPORTS,
        config.discord.includeReportLinks,
    );

    const defaultStrategies = isPlainObject(defaults.strategies) ? defaults.strategies : {};
    const inputStrategies = isPlainObject(base.strategies) ? base.strategies : {};

    const envAllocation = parseAllocationPairs(process.env.PORTFOLIO_ALLOCATION);
    if (envAllocation) {
        inputStrategies.default = {
            ...(isPlainObject(inputStrategies.default) ? inputStrategies.default : {}),
            allocation: envAllocation,
        };
    }

    const strategyKeys = new Set([
        ...Object.keys(defaultStrategies),
        ...Object.keys(inputStrategies),
    ]);
    if (strategyKeys.size === 0) {
        strategyKeys.add("default");
    }

    for (const key of strategyKeys) {
        const defaultStrategy = defaultStrategies[key] ?? defaultStrategies.default ?? DEFAULT_PORTFOLIO_STRATEGY_CONFIG;
        const providedStrategy = inputStrategies[key];
        const strategyBase = isPlainObject(providedStrategy) ? providedStrategy : {};
        const merged = {
            ...defaultStrategy,
            ...strategyBase,
        };
        const allocation = normalizeAllocation(merged.allocation ?? defaultStrategy?.allocation ?? {});
        let minAllocationPct = clampNumber(
            toNumber(merged.minAllocationPct, defaultStrategy?.minAllocationPct ?? 0),
            defaultStrategy?.minAllocationPct ?? 0,
            { min: 0, max: 1 },
        );
        let maxAllocationPct = clampNumber(
            toNumber(merged.maxAllocationPct, defaultStrategy?.maxAllocationPct ?? 1),
            defaultStrategy?.maxAllocationPct ?? 1,
            { min: 0.01, max: 1 },
        );
        if (maxAllocationPct < minAllocationPct) {
            maxAllocationPct = Math.max(minAllocationPct, defaultStrategy?.maxAllocationPct ?? minAllocationPct);
        }
        const name = typeof merged.name === "string" && merged.name.trim() !== ""
            ? merged.name.trim()
            : (defaultStrategy?.name ?? key);
        config.strategies[key] = {
            name,
            allocation,
            minAllocationPct,
            maxAllocationPct,
        };
    }

    if (!config.strategies.default) {
        config.strategies.default = {
            name: "Default",
            allocation: normalizeAllocation(defaultStrategies.default?.allocation ?? {}),
            minAllocationPct: defaultStrategies.default?.minAllocationPct ?? 0,
            maxAllocationPct: defaultStrategies.default?.maxAllocationPct ?? 1,
        };
    }

    return config;
};

const buildDiscordRateLimit = (baseConfig = {}) => {
    const baseDefault = isPlainObject(baseConfig.default) ? baseConfig.default : {};
    const baseWebhooks = isPlainObject(baseConfig.webhooks) ? baseConfig.webhooks : {};
    const fallback = {
        default: {
            capacity: 5,
            refillAmount: 1,
            refillIntervalMs: 1000,
            ...baseDefault,
        },
        webhooks: { ...baseWebhooks },
    };

    const raw = process.env.DISCORD_RATE_LIMIT;
    if (!raw) {
        return fallback;
    }

    try {
        const parsed = JSON.parse(raw);
        const defaultLimit = isPlainObject(parsed.default)
            ? { ...fallback.default, ...parsed.default }
            : fallback.default;
        const webhooks = isPlainObject(parsed.webhooks)
            ? { ...fallback.webhooks, ...parsed.webhooks }
            : fallback.webhooks;

        return {
            default: defaultLimit,
            webhooks,
        };
    } catch (err) {
        logger.warn({ fn: 'buildDiscordRateLimit', raw, err }, 'Failed to parse DISCORD_RATE_LIMIT; using defaults.');
        return fallback;
    }
};

const DEFAULT_ALERT_MODULE_BASE = Object.fromEntries(DEFAULT_ALERT_MODULES.map(name => [name, true]));

const buildAlertModuleConfig = (baseModules = {}) => {
    const enabledList = toStringList(process.env.ALERTS_ENABLED);
    const disabledList = toStringList(process.env.ALERTS_DISABLED);
    const base = {
        ...DEFAULT_ALERT_MODULE_BASE,
        ...baseModules,
    };

    if (enabledList.length > 0) {
        for (const name of DEFAULT_ALERT_MODULES) {
            base[name] = enabledList.includes(name);
        }
        for (const name of enabledList) {
            if (!(name in base)) {
                base[name] = true;
            }
        }
    }

    for (const name of disabledList) {
        base[name] = false;
    }

    return base;
};

const buildIndicatorConfig = (baseConfig = {}) => {
    const baseSma = [
        baseConfig?.smaPeriods?.ma20 ?? 20,
        baseConfig?.smaPeriods?.ma50 ?? 50,
        baseConfig?.smaPeriods?.ma100 ?? 100,
        baseConfig?.smaPeriods?.ma200 ?? 200,
    ];
    const baseEma = [
        baseConfig?.emaPeriods?.ema9 ?? 9,
        baseConfig?.emaPeriods?.ema21 ?? 21,
    ];
    const smaValues = toNumberList(process.env.INDICATOR_SMA_PERIODS, baseSma, baseSma.length);
    const emaValues = toNumberList(process.env.INDICATOR_EMA_PERIODS, baseEma, baseEma.length);

    return {
        smaPeriods: {
            ma20: smaValues[0] ?? baseSma[0],
            ma50: smaValues[1] ?? baseSma[1],
            ma100: smaValues[2] ?? baseSma[2],
            ma200: smaValues[3] ?? baseSma[3],
        },
        emaPeriods: {
            ema9: emaValues[0] ?? baseEma[0],
            ema21: emaValues[1] ?? baseEma[1],
        },
        rsiPeriod: toInt(process.env.INDICATOR_RSI_PERIOD, baseConfig?.rsiPeriod ?? 14),
        macd: {
            fast: toInt(process.env.INDICATOR_MACD_FAST, baseConfig?.macd?.fast ?? 12),
            slow: toInt(process.env.INDICATOR_MACD_SLOW, baseConfig?.macd?.slow ?? 26),
            signal: toInt(process.env.INDICATOR_MACD_SIGNAL, baseConfig?.macd?.signal ?? 9),
        },
        bollinger: {
            period: toInt(process.env.INDICATOR_BB_PERIOD, baseConfig?.bollinger?.period ?? 20),
            multiplier: toNumber(process.env.INDICATOR_BB_MULTIPLIER, baseConfig?.bollinger?.multiplier ?? 2),
        },
        keltner: {
            period: toInt(process.env.INDICATOR_KC_PERIOD, baseConfig?.keltner?.period ?? 20),
            multiplier: toNumber(process.env.INDICATOR_KC_MULTIPLIER, baseConfig?.keltner?.multiplier ?? 2),
        },
        adxPeriod: toInt(process.env.INDICATOR_ADX_PERIOD, baseConfig?.adxPeriod ?? 14),
        atrPeriod: toInt(process.env.INDICATOR_ATR_PERIOD, baseConfig?.atrPeriod ?? 14),
        stochastic: {
            kPeriod: toInt(process.env.INDICATOR_STOCH_K_PERIOD, baseConfig?.stochastic?.kPeriod ?? 14),
            dPeriod: toInt(process.env.INDICATOR_STOCH_D_PERIOD, baseConfig?.stochastic?.dPeriod ?? 3),
        },
        williamsPeriod: toInt(process.env.INDICATOR_WILLR_PERIOD, baseConfig?.williamsPeriod ?? 14),
        cciPeriod: toInt(process.env.INDICATOR_CCI_PERIOD, baseConfig?.cciPeriod ?? 20),
    };
};

export const config = {};

function loadDefaultConfig() {
    try {
        return JSON.parse(readFileSync(DEFAULT_CONFIG_PATH, 'utf-8'));
    } catch (error) {
        console.warn('Failed to load default configuration, falling back to empty object.', error);
        return {};
    }
}

function loadCustomConfig() {
    if (!existsSync(CUSTOM_CONFIG_PATH)) {
        return {};
    }

    try {
        return JSON.parse(readFileSync(CUSTOM_CONFIG_PATH, 'utf-8'));
    } catch (error) {
        const log = withContext(logger);
        log.warn({ fn: 'loadCustomConfig', err: error }, 'Failed to load custom configuration, keeping previous values.');
        return null;
    }
}

function assignConfig(target, source) {
    for (const key of Object.keys(target)) {
        delete target[key];
    }
    Object.assign(target, source);
}

export function onConfigChange(listener) {
    if (typeof listener !== 'function') {
        throw new TypeError('onConfigChange expects a function listener.');
    }

    configListeners.add(listener);
    return () => configListeners.delete(listener);
}

function notifyConfigChange() {
    if (configListeners.size === 0) {
        return;
    }

    for (const listener of configListeners) {
        try {
            listener(CFG);
        } catch (error) {
            const log = withContext(logger);
            log.warn({ fn: 'notifyConfigChange', err: error }, 'Config change listener failed.');
        }
    }
}

function rebuildConfig({ reloadFromDisk = true, emitLog = false } = {}) {
    if (reloadFromDisk) {
        defaultConfig = loadDefaultConfig();
        const maybeCustom = loadCustomConfig();
        if (maybeCustom !== null) {
            customConfig = maybeCustom;
        }
    }

    mergedConfig = clone(defaultConfig);
    deepMerge(mergedConfig, customConfig);

    const nextCFG = clone(mergedConfig);

    nextCFG.webhook = process.env.DISCORD_WEBHOOK_URL ?? nextCFG.webhook ?? null;
    nextCFG.webhookGeneral = process.env.DISCORD_WEBHOOK_GENERAL ?? nextCFG.webhookGeneral ?? null;
    nextCFG.webhookAlerts = process.env.DISCORD_WEBHOOK_ALERTS_URL ?? nextCFG.webhookAlerts ?? null;
    nextCFG.webhookReports = process.env.DISCORD_WEBHOOK_REPORTS_URL ?? nextCFG.webhookReports ?? null;
    nextCFG.webhookDaily = process.env.DISCORD_WEBHOOK_DAILY ?? nextCFG.webhookDaily ?? null;
    nextCFG.webhookAnalysis = process.env.DISCORD_WEBHOOK_ANALYSIS_URL ?? nextCFG.webhookAnalysis ?? null;
    nextCFG.webhookMonthly = process.env.DISCORD_WEBHOOK_MONTHLY ?? nextCFG.webhookMonthly ?? null;
    nextCFG.botToken = process.env.DISCORD_BOT_TOKEN ?? nextCFG.botToken ?? null;
    nextCFG.channelChartsId = process.env.DISCORD_CHANNEL_CHARTS_ID ?? nextCFG.channelChartsId ?? null;

    nextCFG.webhooks = isPlainObject(nextCFG.webhooks) ? nextCFG.webhooks : {};
    const defaultWebhookMap = isPlainObject(mergedConfig.webhooks) ? mergedConfig.webhooks : {};
    const webhookKeys = new Set([
        ...Object.keys(defaultWebhookMap),
        ...Object.keys(nextCFG.webhooks),
    ]);
    for (const envKey of Object.keys(process.env)) {
        if (envKey.startsWith('DISCORD_WEBHOOK_')) {
            webhookKeys.add(envKey.substring('DISCORD_WEBHOOK_'.length));
        }
    }
    for (const key of webhookKeys) {
        const envKey = `DISCORD_WEBHOOK_${key}`;
        nextCFG.webhooks[key] = process.env[envKey] ?? nextCFG.webhooks[key] ?? defaultWebhookMap[key] ?? null;
    }

    for (const { key } of ASSETS) {
        const cfgKey = `webhookReports_${key}`;
        const envKey = `DISCORD_WEBHOOK_REPORTS_${key}`;
        const defaultValue = mergedConfig[cfgKey];
        nextCFG[cfgKey] = process.env[envKey] ?? nextCFG[cfgKey] ?? defaultValue ?? null;
    }

    nextCFG.tz = process.env.TZ ?? nextCFG.tz ?? 'Europe/Lisbon';
    const rawDailyReportHour = process.env.DAILY_REPORT_HOUR ?? nextCFG.dailyReportHour ?? '8';
    const parsedDailyReportHours = toDailyReportHours(rawDailyReportHour);
    nextCFG.dailyReportHours = parsedDailyReportHours;
    nextCFG.dailyReportHour = parsedDailyReportHours.length === 1
        ? parsedDailyReportHours[0]
        : parsedDailyReportHours.slice();
    nextCFG.analysisFrequency = process.env.ANALYSIS_FREQUENCY ?? nextCFG.analysisFrequency ?? 'hourly';
    nextCFG.openrouterApiKey = process.env.OPENROUTER_API_KEY ?? nextCFG.openrouterApiKey ?? null;
    nextCFG.openrouterModel = process.env.OPENROUTER_MODEL ?? nextCFG.openrouterModel ?? 'openrouter/sonoma-dusk-alpha';
    nextCFG.sentimentProvider = (process.env.SENTIMENT_PROVIDER ?? nextCFG.sentimentProvider ?? 'tfjs').toLowerCase();
    nextCFG.sentimentApiUrl = process.env.SENTIMENT_API_URL ?? nextCFG.sentimentApiUrl ?? null;
    nextCFG.sentimentApiKey = process.env.SENTIMENT_API_KEY ?? nextCFG.sentimentApiKey ?? null;
    nextCFG.enableCharts = toBoolean(process.env.ENABLE_CHARTS, nextCFG.enableCharts ?? true);
    nextCFG.enableAlerts = toBoolean(process.env.ENABLE_ALERTS, nextCFG.enableAlerts ?? true);
    nextCFG.enableAnalysis = toBoolean(process.env.ENABLE_ANALYSIS, nextCFG.enableAnalysis ?? true);
    nextCFG.enableReports = toBoolean(process.env.ENABLE_REPORTS, nextCFG.enableReports ?? true);
    nextCFG.enableBinanceCommand = toBoolean(
        process.env.ENABLE_BINANCE_COMMAND,
        nextCFG.enableBinanceCommand ?? true,
    );
    nextCFG.debug = toBoolean(process.env.DEBUG, nextCFG.debug ?? false);
    nextCFG.accountEquity = toNumber(process.env.ACCOUNT_EQUITY, nextCFG.accountEquity ?? 0);
    nextCFG.riskPerTrade = toNumber(process.env.RISK_PER_TRADE, nextCFG.riskPerTrade ?? 0.01);
    const baseMinProfit = normalizeMinimumProfitThreshold(
        mergedConfig.minimumProfitThreshold ?? nextCFG.minimumProfitThreshold,
        DEFAULT_MIN_PROFIT_CONFIG,
    );
    const envMinProfit = parseMinimumProfitValue(process.env.MIN_PROFIT_THRESHOLD);
    if (envMinProfit !== null) {
        baseMinProfit.default = envMinProfit;
    }
    nextCFG.minimumProfitThreshold = baseMinProfit;
    nextCFG.alertDedupMinutes = toNumber(process.env.ALERT_DEDUP_MINUTES, nextCFG.alertDedupMinutes ?? 60);

    const baseCacheTtl = mergedConfig.binanceCacheTTL ?? DEFAULT_BINANCE_CACHE_TTL_MINUTES_FALLBACK;
    const computedBinanceCacheTTL = toNumber(
        process.env.BINANCE_CACHE_TTL_MINUTES,
        nextCFG.binanceCacheTTL ?? baseCacheTtl,
    );
    nextCFG.binanceCacheTTL = Number.isFinite(computedBinanceCacheTTL) && computedBinanceCacheTTL > 0
        ? computedBinanceCacheTTL
        : baseCacheTtl;

    const defaultMaxConcurrency = Number.isFinite(nextCFG.maxConcurrency) ? nextCFG.maxConcurrency : undefined;
    const computedMaxConcurrency = process.env.MAX_CONCURRENCY !== undefined
        ? toInt(process.env.MAX_CONCURRENCY, defaultMaxConcurrency)
        : defaultMaxConcurrency;
    nextCFG.maxConcurrency = Number.isFinite(computedMaxConcurrency) ? computedMaxConcurrency : undefined;
    nextCFG.trading = buildTradingConfig(nextCFG.trading);
    nextCFG.marketPosture = buildMarketPostureConfig(nextCFG.marketPosture);
    nextCFG.forecasting = buildForecastConfig(nextCFG.forecasting);
    nextCFG.portfolioGrowth = buildPortfolioGrowthConfig(nextCFG.portfolioGrowth);
    nextCFG.indicators = buildIndicatorConfig(mergedConfig.indicators ?? nextCFG.indicators ?? {});
    nextCFG.alerts = isPlainObject(nextCFG.alerts) ? nextCFG.alerts : {};
    nextCFG.alerts.modules = buildAlertModuleConfig(mergedConfig.alerts?.modules ?? nextCFG.alerts?.modules ?? {});
    nextCFG.alertThresholds = clone(mergedConfig.alertThresholds ?? nextCFG.alertThresholds ?? {});
    nextCFG.discordRateLimit = buildDiscordRateLimit(mergedConfig.discordRateLimit ?? nextCFG.discordRateLimit ?? {});

    loadSettings({
        riskPerTrade: nextCFG.riskPerTrade,
        minimumProfitThreshold: nextCFG.minimumProfitThreshold,
    });

    const storedRisk = getSetting('riskPerTrade', nextCFG.riskPerTrade);
    if (typeof storedRisk === 'number' && Number.isFinite(storedRisk) && storedRisk >= 0 && storedRisk <= 0.05) {
        nextCFG.riskPerTrade = storedRisk;
    } else if (storedRisk !== nextCFG.riskPerTrade) {
        setSetting('riskPerTrade', nextCFG.riskPerTrade);
    }

    const storedMinProfit = getSetting('minimumProfitThreshold', nextCFG.minimumProfitThreshold);
    const normalizedStoredMinProfit = normalizeMinimumProfitThreshold(storedMinProfit, nextCFG.minimumProfitThreshold);
    const shouldPersistMinProfit = !isPlainObject(storedMinProfit)
        || JSON.stringify(storedMinProfit) !== JSON.stringify(normalizedStoredMinProfit);
    nextCFG.minimumProfitThreshold = normalizedStoredMinProfit;
    if (shouldPersistMinProfit) {
        setSetting('minimumProfitThreshold', normalizedStoredMinProfit);
    }

    assignConfig(CFG, nextCFG);

    const nextConfig = {
        newsApiKey: process.env.NEWS_API_KEY ?? mergedConfig.newsApiKey ?? null,
        serpapiApiKey: process.env.SERPAPI_API_KEY ?? mergedConfig.serpapiApiKey ?? null,
    };
    assignConfig(config, nextConfig);

    validateConfig();
    notifyConfigChange();

    if (emitLog) {
        const log = withContext(logger);
        log.info({ fn: 'rebuildConfig' }, '♻️ Reloaded custom configuration.');
    }
}

function ensureCustomConfigWatcher() {
    if (customFileWatcher) {
        return;
    }

    try {
        customFileWatcher = watch(CUSTOM_CONFIG_PATH, (eventType) => {
            if (eventType === 'rename') {
                if (customFileWatcher) {
                    customFileWatcher.close();
                    customFileWatcher = null;
                }
                ensureCustomConfigWatcher();
            }

            if (skipNextWatchReload) {
                skipNextWatchReload = false;
                return;
            }

            if (eventType !== 'change' && eventType !== 'rename') {
                return;
            }

            if (watchTimeout) {
                clearTimeout(watchTimeout);
            }
            watchTimeout = setTimeout(() => {
                watchTimeout = undefined;
                try {
                    rebuildConfig({ emitLog: true });
                } catch (error) {
                    const log = withContext(logger);
                    log.warn({ fn: 'ensureCustomConfigWatcher', err: error }, 'Failed to reload custom configuration.');
                }
            }, WATCH_DEBOUNCE_MS);
        });
    } catch (error) {
        if (error.code === 'ENOENT') {
            if (!customDirWatcher) {
                customDirWatcher = watch(CONFIG_DIR_PATH, (_, filename) => {
                    if (filename === 'custom.json') {
                        if (customDirWatcher) {
                            customDirWatcher.close();
                            customDirWatcher = null;
                        }
                        ensureCustomConfigWatcher();
                    }
                });
            }
        } else {
            const log = withContext(logger);
            log.warn({ fn: 'ensureCustomConfigWatcher', err: error }, 'Failed to watch custom configuration file.');
        }
    }
}

export async function saveConfig(partialConfig) {
    if (!isPlainObject(partialConfig)) {
        throw new TypeError('saveConfig expects a plain object.');
    }

    deepMerge(customConfig, partialConfig);
    if (customConfig.minimumProfitThreshold !== undefined) {
        const fallback = isPlainObject(CFG.minimumProfitThreshold)
            ? CFG.minimumProfitThreshold
            : DEFAULT_MIN_PROFIT_CONFIG;
        customConfig.minimumProfitThreshold = normalizeMinimumProfitThreshold(
            customConfig.minimumProfitThreshold,
            fallback,
        );
    }
    skipNextWatchReload = true;
    await writeFile(CUSTOM_CONFIG_PATH, `${JSON.stringify(customConfig, null, 4)}\n`);
    rebuildConfig({ reloadFromDisk: false });
    setTimeout(() => {
        skipNextWatchReload = false;
    }, WATCH_DEBOUNCE_MS);
}

export function validateConfig() {
    const missing = [];

    if (!CFG.webhook) {
        missing.push('DISCORD_WEBHOOK_URL');
    }

    for (const { key } of ASSETS) {
        if (!process.env[`BINANCE_SYMBOL_${key}`]) {
            missing.push(`BINANCE_SYMBOL_${key}`);
        }
    }

    const apiKeys = [
        ['OPENROUTER_API_KEY', CFG.openrouterApiKey],
        ['NEWS_API_KEY', config.newsApiKey],
        ['SERPAPI_API_KEY', config.serpapiApiKey],
    ];
    for (const [envKey, value] of apiKeys) {
        if (!value) {
            missing.push(envKey);
        }
    }

    if (missing.length > 0) {
        const message = `Missing required environment variables: ${missing.join(', ')}`;
        if (process.env.NODE_ENV === 'production') {
            throw new Error(message);
        } else {
            const log = withContext(logger);
            log.warn({ fn: 'validateConfig' }, message);
        }
    }
}

rebuildConfig();
ensureCustomConfigWatcher();
