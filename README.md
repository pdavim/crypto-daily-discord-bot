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

## Environment Variables

The `.env.example` file documents each available variable with a purpose and example value.

Key variables:

- `MAX_CONCURRENCY` – optional limit for parallel analyses. When omitted or invalid the bot automatically matches the number of available CPU cores; set to `1` to force sequential processing.
- `BINANCE_CACHE_TTL_MINUTES` – cache duration for Binance price data in minutes (defaults to 10 minutes when unset or invalid). This value is available at runtime as `CFG.binanceCacheTTL` and controls the TTL of the shared Binance `LRUCache` instance.

## Technical Articles

- [Getting started with Discord webhooks](https://support.discord.com/hc/en-us/articles/228383668)
- [Scheduling cron jobs in Node.js](https://blog.logrocket.com/how-to-use-node-cron/)
- [Binance spot API trading guide](https://binance-docs.github.io/apidocs/spot/en/)

The bot logs a warning and skips work when required webhooks are missing so deployments fail fast.
