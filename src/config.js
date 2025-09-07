import 'dotenv/config';
export const CFG = {
    mode: (process.env.DATA_MODE || 'binance').toLowerCase(),
    webhook: process.env.DISCORD_WEBHOOK_URL,
    webhookAlerts: process.env.DISCORD_WEBHOOK_ALERTS_URL,
    webhookReports: process.env.DISCORD_WEBHOOK_REPORTS_URL,
    webhooks: {
        BTC: process.env.DISCORD_WEBHOOK_BTC,
        ETH: process.env.DISCORD_WEBHOOK_ETH
    },
    tz: process.env.TZ || 'Europe/Lisbon'
};


