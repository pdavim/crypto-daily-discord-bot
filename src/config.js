import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { ASSETS } from './assets.js';
import { logger, withContext } from './logger.js';
import { DEFAULT_ALERT_MODULES } from './alerts/registry.js';
import { loadSettings, getSetting, setSetting } from './settings.js';

const DEFAULT_CONFIG_PATH = new URL('../config/default.json', import.meta.url);
const CUSTOM_CONFIG_PATH = new URL('../config/custom.json', import.meta.url);

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

let DEFAULT_CONFIG = {};
try {
    DEFAULT_CONFIG = JSON.parse(readFileSync(DEFAULT_CONFIG_PATH, 'utf-8'));
} catch (error) {
    console.warn('Failed to load default configuration, falling back to empty object.', error);
    DEFAULT_CONFIG = {};
}

if (existsSync(CUSTOM_CONFIG_PATH)) {
    try {
        const customConfig = JSON.parse(readFileSync(CUSTOM_CONFIG_PATH, 'utf-8'));
        deepMerge(DEFAULT_CONFIG, customConfig);
    } catch (error) {
        console.warn('Failed to load custom configuration, ignoring.', error);
    }
}

export const CFG = clone(DEFAULT_CONFIG);

const DEFAULT_BINANCE_CACHE_TTL_MINUTES = DEFAULT_CONFIG.binanceCacheTTL ?? 10;

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

CFG.webhook = process.env.DISCORD_WEBHOOK_URL ?? CFG.webhook ?? null;
CFG.webhookAlerts = process.env.DISCORD_WEBHOOK_ALERTS_URL ?? CFG.webhookAlerts ?? null;
CFG.webhookReports = process.env.DISCORD_WEBHOOK_REPORTS_URL ?? CFG.webhookReports ?? null;
CFG.webhookDaily = process.env.DISCORD_WEBHOOK_DAILY ?? CFG.webhookDaily ?? null;
CFG.webhookAnalysis = process.env.DISCORD_WEBHOOK_ANALYSIS_URL ?? CFG.webhookAnalysis ?? null;
CFG.botToken = process.env.DISCORD_BOT_TOKEN ?? CFG.botToken ?? null;
CFG.channelChartsId = process.env.DISCORD_CHANNEL_CHARTS_ID ?? CFG.channelChartsId ?? null;

CFG.webhooks = isPlainObject(CFG.webhooks) ? CFG.webhooks : {};
const defaultWebhookMap = isPlainObject(DEFAULT_CONFIG.webhooks) ? DEFAULT_CONFIG.webhooks : {};
const webhookKeys = new Set([
    ...Object.keys(defaultWebhookMap),
    ...Object.keys(CFG.webhooks),
]);
for (const envKey of Object.keys(process.env)) {
    if (envKey.startsWith('DISCORD_WEBHOOK_')) {
        webhookKeys.add(envKey.substring('DISCORD_WEBHOOK_'.length));
    }
}
for (const key of webhookKeys) {
    const envKey = `DISCORD_WEBHOOK_${key}`;
    CFG.webhooks[key] = process.env[envKey] ?? CFG.webhooks[key] ?? defaultWebhookMap[key] ?? null;
}

CFG.tz = process.env.TZ ?? CFG.tz ?? 'Europe/Lisbon';
CFG.dailyReportHour = process.env.DAILY_REPORT_HOUR ?? CFG.dailyReportHour ?? '8';
CFG.analysisFrequency = process.env.ANALYSIS_FREQUENCY ?? CFG.analysisFrequency ?? 'hourly';
CFG.openrouterApiKey = process.env.OPENROUTER_API_KEY ?? CFG.openrouterApiKey ?? null;
CFG.openrouterModel = process.env.OPENROUTER_MODEL ?? CFG.openrouterModel ?? 'openrouter/sonoma-dusk-alpha';
CFG.enableCharts = toBoolean(process.env.ENABLE_CHARTS, CFG.enableCharts ?? true);
CFG.enableAlerts = toBoolean(process.env.ENABLE_ALERTS, CFG.enableAlerts ?? true);
CFG.enableAnalysis = toBoolean(process.env.ENABLE_ANALYSIS, CFG.enableAnalysis ?? true);
CFG.enableReports = toBoolean(process.env.ENABLE_REPORTS, CFG.enableReports ?? true);
CFG.debug = toBoolean(process.env.DEBUG, CFG.debug ?? false);
CFG.accountEquity = toNumber(process.env.ACCOUNT_EQUITY, CFG.accountEquity ?? 0);
CFG.riskPerTrade = toNumber(process.env.RISK_PER_TRADE, CFG.riskPerTrade ?? 0.01);
CFG.alertDedupMinutes = toNumber(process.env.ALERT_DEDUP_MINUTES, CFG.alertDedupMinutes ?? 60);
const computedBinanceCacheTTL = toNumber(
    process.env.BINANCE_CACHE_TTL_MINUTES,
    CFG.binanceCacheTTL ?? DEFAULT_BINANCE_CACHE_TTL_MINUTES,
);
CFG.binanceCacheTTL = Number.isFinite(computedBinanceCacheTTL) && computedBinanceCacheTTL > 0
    ? computedBinanceCacheTTL
    : DEFAULT_BINANCE_CACHE_TTL_MINUTES;

const defaultMaxConcurrency = Number.isFinite(CFG.maxConcurrency) ? CFG.maxConcurrency : undefined;
const computedMaxConcurrency = process.env.MAX_CONCURRENCY !== undefined
    ? toInt(process.env.MAX_CONCURRENCY, defaultMaxConcurrency)
    : defaultMaxConcurrency;
CFG.maxConcurrency = Number.isFinite(computedMaxConcurrency) ? computedMaxConcurrency : undefined;
CFG.indicators = buildIndicatorConfig(DEFAULT_CONFIG.indicators ?? CFG.indicators ?? {});
CFG.alerts = isPlainObject(CFG.alerts) ? CFG.alerts : {};
CFG.alerts.modules = buildAlertModuleConfig(DEFAULT_CONFIG.alerts?.modules ?? CFG.alerts?.modules ?? {});
CFG.alertThresholds = clone(DEFAULT_CONFIG.alertThresholds ?? CFG.alertThresholds ?? {});
CFG.discordRateLimit = buildDiscordRateLimit(DEFAULT_CONFIG.discordRateLimit ?? CFG.discordRateLimit ?? {});

loadSettings({
    riskPerTrade: CFG.riskPerTrade,
});

const storedRisk = getSetting('riskPerTrade', CFG.riskPerTrade);
if (typeof storedRisk === 'number' && Number.isFinite(storedRisk) && storedRisk >= 0 && storedRisk <= 0.05) {
    CFG.riskPerTrade = storedRisk;
} else if (storedRisk !== CFG.riskPerTrade) {
    setSetting('riskPerTrade', CFG.riskPerTrade);
}

export const config = {
    newsApiKey: process.env.NEWS_API_KEY ?? DEFAULT_CONFIG.newsApiKey ?? null,
    serpapiApiKey: process.env.SERPAPI_API_KEY ?? DEFAULT_CONFIG.serpapiApiKey ?? null,
};

export async function saveConfig(partialConfig) {
    if (!isPlainObject(partialConfig)) {
        throw new TypeError('saveConfig expects a plain object.');
    }

    deepMerge(DEFAULT_CONFIG, partialConfig);
    deepMerge(CFG, partialConfig);

    await writeFile(CUSTOM_CONFIG_PATH, `${JSON.stringify(CFG, null, 4)}\n`);
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

validateConfig();
