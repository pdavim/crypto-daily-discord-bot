import 'dotenv/config';
export const CFG = {
    mode: (process.env.DATA_MODE || 'binance').toLowerCase(),
    webhook: process.env.DISCORD_WEBHOOK_URL,
    webhookAlerts: process.env.DISCORD_WEBHOOK_ALERTS_URL,
    webhookReports: process.env.DISCORD_WEBHOOK_REPORTS_URL,
    webhooks: {
        BTC: process.env.DISCORD_WEBHOOK_BTC,
        ETH: process.env.DISCORD_WEBHOOK_ETH,
        POL: process.env.DISCORD_WEBHOOK_POL,
        SUI: process.env.DISCORD_WEBHOOK_SUI,
        SOL: process.env.DISCORD_WEBHOOK_SOL,
        TRX: process.env.DISCORD_WEBHOOK_TRX
    },
    tz: process.env.TZ || 'Europe/Lisbon'
};

export const config = {
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    newsApiKey: process.env.NEWS_API_KEY,
};

