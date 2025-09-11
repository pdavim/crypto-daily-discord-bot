import 'dotenv/config';
import { ASSETS } from './assets.js';
import { logger } from './logger.js';
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
            logger.warn({ asset: undefined, timeframe: undefined, fn: 'validateConfig' }, message);
        }
    }
}

validateConfig();
