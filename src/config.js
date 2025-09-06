import 'dotenv/config';
export const CFG = {
    mode: (process.env.DATA_MODE || 'binance').toLowerCase(),
    webhook: process.env.DISCORD_WEBHOOK_URL,
    tz: process.env.TZ || 'Europe/Lisbon'
};
