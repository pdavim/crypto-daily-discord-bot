# Crypto Daily Discord Bot

[![Test Status](https://github.com/OWNER/crypto-daily-discord-bot/actions/workflows/test.yml/badge.svg)](https://github.com/OWNER/crypto-daily-discord-bot/actions/workflows/test.yml)

This project posts crypto analysis, charts and alerts to Discord.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in the values for your environment.

3. Create the `logs/` directory used for rotating log files. The bot writes daily files as `logs/app-YYYY-MM-DD.log` and automatically prunes entries older than seven days:

   ```bash
   mkdir logs
   ```

## Running

- Start scheduled jobs:

  ```bash
  npm start
  ```

- Run a single cycle for testing:

  ```bash
  npm run once
  ```

## Configuration CLI

Manage `config/custom.json` without editing files manually using the bundled helper:

```bash
npm exec config-cli list
```

Common commands:

- `npm exec config-cli list` – print the merged configuration as formatted JSON.
- `npm exec config-cli get alerts.modules.rsi` – inspect a nested value using dot notation.
- `npm exec config-cli set alerts.modules.rsi false` – persist a value to `config/custom.json` (numbers, booleans and JSON strings are parsed automatically).

## Discord Commands

- `/chart` – gera um gráfico para o ativo e timeframe informados.
- `/watch` – adiciona ou remove ativos da watchlist (subcomandos `add` e `remove`).
- `/status` – mostra o uptime atual do bot e a lista de ativos monitorados.

## Housekeeping

- Alert deduplication entries older than seven days are pruned automatically once per day. The pruning job also runs on start-up so long-running processes and ephemeral runs stay in sync.
- Watchlist and alert cache files are deleted when empty, keeping the `data/` directory tidy in clean environments and tests.
- Weekly performance snapshots are persisted to `reports/weekly.json`, capturing seven-day returns and runtime metrics without posting to Discord.
- On the first day of each month (01h in the configured timezone) the bot compiles a performance chart using the stored snapshots and delivers the report via the monthly webhook.

## Environment Variables

The `.env.example` file documents each available variable with a purpose and example value.

Key variables:

- `MAX_CONCURRENCY` – optional limit for parallel analyses. When omitted or invalid the bot automatically matches the number of available CPU cores; set to `1` to force sequential processing.
- `BINANCE_CACHE_TTL_MINUTES` – cache duration for Binance price data in minutes (defaults to 10 minutes when unset or invalid). This value is available at runtime as `CFG.binanceCacheTTL` and controls the TTL of the shared Binance `LRUCache` instance.
- Indicator overrides – the `CFG.indicators` section centralises every period and multiplier used while computing technical indicators. Environment variables such as `INDICATOR_SMA_PERIODS`, `INDICATOR_MACD_FAST` or `INDICATOR_BB_MULTIPLIER` let you customise the moving averages, MACD windows and Bollinger/Keltner multipliers without touching the codebase. See `.env.example` for concrete values.
- `DISCORD_WEBHOOK_MONTHLY` – optional webhook URL used to deliver the monthly performance chart. Falls back to `webhookReports`/`webhook` when unset.

Example snippet for `.env`:

```dotenv
INDICATOR_SMA_PERIODS=10,40,100,200
INDICATOR_MACD_FAST=8
INDICATOR_MACD_SLOW=21
INDICATOR_MACD_SIGNAL=5
INDICATOR_BB_MULTIPLIER=2.5
```

## Technical Articles

- [Getting started with Discord webhooks](https://support.discord.com/hc/en-us/articles/228383668)
- [Scheduling cron jobs in Node.js](https://blog.logrocket.com/how-to-use-node-cron/)
- [Binance spot API trading guide](https://binance-docs.github.io/apidocs/spot/en/)

The bot logs a warning and skips work when required webhooks are missing so deployments fail fast.
