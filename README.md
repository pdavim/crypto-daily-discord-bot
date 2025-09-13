# Crypto Daily Discord Bot

This project posts crypto analysis, charts and alerts to Discord.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in the values for your environment.

3. Create the `logs/` directory used for rotating log files:

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

- `MAX_CONCURRENCY` – optional limit for parallel analyses (defaults to the number of CPU cores).

## Technical Articles

- [Getting started with Discord webhooks](https://support.discord.com/hc/en-us/articles/228383668)
- [Scheduling cron jobs in Node.js](https://blog.logrocket.com/how-to-use-node-cron/)
- [Binance spot API trading guide](https://binance-docs.github.io/apidocs/spot/en/)

The bot logs a warning and skips work when required webhooks are missing so deployments fail fast.
