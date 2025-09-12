# Crypto Daily Discord Bot

This project posts crypto analysis, charts and alerts to Discord.

## Environment Variables

Copy `.env.example` to `.env` and provide values for the variables below before running the bot:

- `DISCORD_WEBHOOK_URL` – default channel webhook
- `DISCORD_WEBHOOK_ALERTS_URL` – alert channel webhook
- `DISCORD_WEBHOOK_REPORTS_URL` – reports channel webhook
- `DISCORD_WEBHOOK_ANALYSIS_URL` – analysis channel webhook
- `DISCORD_WEBHOOK_BTC`, `DISCORD_WEBHOOK_ETH` – asset specific webhooks
- `OPENROUTER_API_KEY` – OpenRouter access key
- `NEWS_API_KEY` – NewsAPI key
- `SERPAPI_API_KEY` – SerpAPI key
- `ALERT_DEDUP_MINUTES` – minutes to suppress duplicate alerts

The bot logs a warning and skips work when required webhooks are missing so deployments fail fast.
