import 'dotenv/config';
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
};

export const config = {
    newsApiKey: process.env.NEWS_API_KEY,
    serpapiApiKey: process.env.SERPAPI_API_KEY,
};
