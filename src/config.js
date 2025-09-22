import 'dotenv/config';
import { ASSETS } from './assets.js';
import { logger, withContext } from './logger.js';
const DEFAULT_BINANCE_CACHE_TTL_MINUTES = 10;
const parsedBinanceCacheTTL = Number.parseFloat(process.env.BINANCE_CACHE_TTL_MINUTES ?? '');
const binanceCacheTTL = Number.isFinite(parsedBinanceCacheTTL) && parsedBinanceCacheTTL > 0
    ? parsedBinanceCacheTTL
    : DEFAULT_BINANCE_CACHE_TTL_MINUTES;

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

const buildIndicatorConfig = () => {
    const defaultSma = [20, 50, 100, 200];
    const smaValues = toNumberList(process.env.INDICATOR_SMA_PERIODS, defaultSma, defaultSma.length);
    const defaultEma = [9, 21];
    const emaValues = toNumberList(process.env.INDICATOR_EMA_PERIODS, defaultEma, defaultEma.length);

    return {
        smaPeriods: {
            ma20: smaValues[0] ?? defaultSma[0],
            ma50: smaValues[1] ?? defaultSma[1],
            ma100: smaValues[2] ?? defaultSma[2],
            ma200: smaValues[3] ?? defaultSma[3]
        },
        emaPeriods: {
            ema9: emaValues[0] ?? defaultEma[0],
            ema21: emaValues[1] ?? defaultEma[1]
        },
        rsiPeriod: toInt(process.env.INDICATOR_RSI_PERIOD, 14),
        macd: {
            fast: toInt(process.env.INDICATOR_MACD_FAST, 12),
            slow: toInt(process.env.INDICATOR_MACD_SLOW, 26),
            signal: toInt(process.env.INDICATOR_MACD_SIGNAL, 9)
        },
        bollinger: {
            period: toInt(process.env.INDICATOR_BB_PERIOD, 20),
            multiplier: toNumber(process.env.INDICATOR_BB_MULTIPLIER, 2)
        },
        keltner: {
            period: toInt(process.env.INDICATOR_KC_PERIOD, 20),
            multiplier: toNumber(process.env.INDICATOR_KC_MULTIPLIER, 2)
        },
        adxPeriod: toInt(process.env.INDICATOR_ADX_PERIOD, 14),
        atrPeriod: toInt(process.env.INDICATOR_ATR_PERIOD, 14),
        stochastic: {
            kPeriod: toInt(process.env.INDICATOR_STOCH_K_PERIOD, 14),
            dPeriod: toInt(process.env.INDICATOR_STOCH_D_PERIOD, 3)
        },
        williamsPeriod: toInt(process.env.INDICATOR_WILLR_PERIOD, 14),
        cciPeriod: toInt(process.env.INDICATOR_CCI_PERIOD, 20)
    };
};

export const CFG = {
    webhook: process.env.DISCORD_WEBHOOK_URL,
    webhookAlerts: process.env.DISCORD_WEBHOOK_ALERTS_URL,
    webhookReports: process.env.DISCORD_WEBHOOK_REPORTS_URL,
    webhookDaily: process.env.DISCORD_WEBHOOK_DAILY,
    webhookAnalysis: process.env.DISCORD_WEBHOOK_ANALYSIS_URL,
    botToken: process.env.DISCORD_BOT_TOKEN,
    channelChartsId: process.env.DISCORD_CHANNEL_CHARTS_ID,
    webhooks: {
        BTC: process.env.DISCORD_WEBHOOK_BTC,
        ETH: process.env.DISCORD_WEBHOOK_ETH,
        POL: process.env.DISCORD_WEBHOOK_POL,
        SUI: process.env.DISCORD_WEBHOOK_SUI,
        SOL: process.env.DISCORD_WEBHOOK_SOL,
        TRX: process.env.DISCORD_WEBHOOK_TRX
    },
    tz: process.env.TZ || 'Europe/Lisbon',
    dailyReportHour: process.env.DAILY_REPORT_HOUR || '8',
    analysisFrequency: process.env.ANALYSIS_FREQUENCY || 'hourly',
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    openrouterModel: process.env.OPENROUTER_MODEL || 'openrouter/sonoma-dusk-alpha',
    enableCharts: process.env.ENABLE_CHARTS === undefined || process.env.ENABLE_CHARTS === 'true',
    enableAlerts: process.env.ENABLE_ALERTS === undefined || process.env.ENABLE_ALERTS === 'true',
    enableAnalysis: process.env.ENABLE_ANALYSIS === undefined || process.env.ENABLE_ANALYSIS === 'true',
    enableReports: process.env.ENABLE_REPORTS === undefined || process.env.ENABLE_REPORTS === 'true',
    debug: process.env.DEBUG?.toLowerCase() === 'true',
    accountEquity: parseFloat(process.env.ACCOUNT_EQUITY || '0'),
    riskPerTrade: parseFloat(process.env.RISK_PER_TRADE || '0.01'),
    alertDedupMinutes: parseFloat(process.env.ALERT_DEDUP_MINUTES || '60'),
    binanceCacheTTL,
    maxConcurrency: process.env.MAX_CONCURRENCY ? parseInt(process.env.MAX_CONCURRENCY, 10) : undefined,
    indicators: buildIndicatorConfig()
};

export const config = {
    newsApiKey: process.env.NEWS_API_KEY,
    serpapiApiKey: process.env.SERPAPI_API_KEY,
};

export function validateConfig() {
    const missing = [];

    if (!process.env.DISCORD_WEBHOOK_URL) {
        missing.push('DISCORD_WEBHOOK_URL');
    }

    for (const { key } of ASSETS) {
        if (!process.env[`BINANCE_SYMBOL_${key}`]) {
            missing.push(`BINANCE_SYMBOL_${key}`);
        }
    }

    const apiKeys = ['OPENROUTER_API_KEY', 'NEWS_API_KEY', 'SERPAPI_API_KEY'];
    for (const key of apiKeys) {
        if (!process.env[key]) {
            missing.push(key);
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
