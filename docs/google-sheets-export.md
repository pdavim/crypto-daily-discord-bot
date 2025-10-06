# Google Sheets Export Design

## Worksheet layout
- Create one worksheet per Discord destination to maintain channel-specific formatting and filters.
  - Aggregated asset alerts (`scope: aggregate`) and timeframe guidance messages (`scope: guidance`) already expose the originating webhook via optional `options.webhookUrl`; resolve this to a stable worksheet name (e.g., `alerts-general`).
  - Portfolio growth digests may post to a dedicated webhook/channel pair defined under `CFG.portfolioGrowth.discord`; treat each unique `(webhookUrl, channelId)` tuple as a worksheet (e.g., `portfolio-growth`).
  - Chart uploads posted with the bot client use `CFG.channelChartsId` instead of webhooks; reserve a worksheet such as `charts-bot` for these uploads.
  - Trading automation events (`trading_decision`, `trading_execution`, `trading_margin`) honour `trading.logging.sheetKey` (default `trading_actions`) so they can be audited alongside Discord alerts.

## Required columns
| Column | Description |
| --- | --- |
| `timestamp` | ISO-8601 timestamp (UTC) when the message was submitted to Google Sheets, not Discord latency. |
| `channel_id` | Normalized channel identifier: supplied `channelId` option, extracted webhook channel, or the bot channel ID. |
| `webhook_url` | Raw webhook URL when available for traceability; blank for bot uploads. |
| `message_type` | Enum covering `aggregate_alert`, `guidance_alert`, `portfolio_growth`, `chart_upload`, `analysis_report`, `monthly_report`, `trading_decision`, `trading_execution`, `trading_margin`. |
| `asset` | Asset key when supplied by the payload (e.g., aggregate/guidance alerts). |
| `timeframe` | Scope or timeframe label supplied with the payload (`aggregate`, `guidance`, `4h`, etc.). |
| `content` | Markdown or plaintext body dispatched to Discord. |
| `attachments` | Comma-separated list of attachment URLs (see normalization rules). |
| `metadata` | JSON blob capturing auxiliary properties (hashes, variation metrics, portfolio stats) as they become available. |

## Normalization rules
- **Timestamps**: store as UTC ISO strings (`YYYY-MM-DDTHH:mm:ss.sssZ`) to avoid locale drift; capture local time separately inside the `metadata` column when `CFG.tz` context is required.
- **Locale-sensitive numbers**: preserve original formatting in `content` but ensure numeric values copied into `metadata` use dot decimal separators for interoperability.
- **Attachment URLs**: for webhook posts, convert the local file paths (e.g., monthly report chart, portfolio growth attachments) into publicly accessible object storage URLs prior to writing rows; for bot-uploaded charts the Discord CDN URL from the send result must be captured asynchronously.
- **Deduplication**: use the existing alert hash (`buildHash`) and dispatch scope to avoid inserting duplicate rows; store the hash inside `metadata.hash` when available.
- **Error handling**: if a delivery attempt fails, log the failure without inserting a sheet row to keep exports aligned with actual Discord history.

## Implementation notes
- Hook the export at the same points where `enqueueAlertPayload`, `flushAlertQueue`, and portfolio growth dispatch currently operate so all metadata (asset, timeframe, webhook overrides, attachments) is available before network calls.【F:src/index.js†L560-L705】【F:src/alerts/dispatcher.js†L61-L94】
- Reuse the webhook resolution logic from `postAnalysis`, `postMonthlyReport`, `sendDiscordAlert`, and `sendDiscordAlertWithAttachments` to populate `channel_id` and `webhook_url` consistently with existing delivery paths.【F:src/discord.js†L48-L317】
- Chart uploads triggered by `postCharts` should capture the static `CFG.channelChartsId` and the list of file paths prior to upload for later URL reconciliation.【F:src/discordBot.js†L1145-L1161】
