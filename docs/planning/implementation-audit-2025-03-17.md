# Implementation Audit – Crypto Daily Discord Bot (2025-03-17)

## Approach
- Reviewed the orchestrator (`src/index.js`), indicator/charting stack, and delivery pipelines to understand how data flows from exchanges to Discord, Sheets, and trading automation.【F:src/index.js†L1-L744】
- Inspected analytics helpers (charts, reporter, forecasting, portfolio simulation) and their corresponding tests to confirm existing coverage and identify validation gaps.【F:src/chart.js†L1-L120】【F:src/forecasting.js†L1-L120】【F:src/portfolio/growth.js†L1-L160】【F:tests/chart.test.js†L129-L168】
- Evaluated integrations for alerts, Google Sheets logging, Binance execution, dashboard, and KaibanJS multi-agent coordination, including associated test suites.【F:src/alerts.js†L1-L131】【F:src/controllers/sheetsReporter.js†L1-L200】【F:src/trading/automation.js†L1-L160】【F:src/dashboard/server.js†L1-L160】【F:src/agents/team.js†L320-L404】【F:tests/agents/team.test.js†L304-L343】

## Capability Snapshot
- **Daily pipeline** already computes indicators, renders candlestick charts, and posts structured analyses/alerts with deduplication and Google Sheets archiving hooks.【F:src/index.js†L183-L744】
- **Alert engine** supports modular detectors, severity formatting, and aggregation before Discord delivery and Sheets logging.【F:src/alerts.js†L22-L131】【F:src/index.js†L560-L744】
- **Forecasting & simulations** persist regression-based predictions and run portfolio growth experiments with Discord/web outputs.【F:src/forecasting.js†L1-L120】【F:src/portfolio/growth.js†L1-L160】【F:src/index.js†L730-L856】
- **Trading stack** integrates risk-aware automation atop the Binance connector with compliance metadata exported to Sheets.【F:src/trading/automation.js†L1-L160】【F:src/trading/riskManager.js†L1-L200】【F:src/controllers/sheetsReporter.js†L79-L140】
- **Multi-agent Kaiban workflow** assembles specialist roles and produces final decision packages consumed by the legacy report channel.【F:src/agents/team.js†L320-L404】【F:src/ai.js†L313-L330】
- **Dashboard and metrics endpoints** expose health data, forecast snapshots, and trade logs for monitoring.【F:src/dashboard/server.js†L1-L160】

## Detailed Tasks & Action Items

### 1. Daily Technical Analysis & Charting
**Observations**
- `runOnceForAsset` ingests multi-timeframe candles, computes indicators, generates charts/forecasts, and posts analysis plus guidance bundles.【F:src/index.js†L183-L744】
- Chart rendering already handles candlesticks, overlays, and optional volume/PSAR layers with performance telemetry and tests.【F:src/chart.js†L1-L120】【F:tests/chart.test.js†L129-L168】
- Asset config currently lists Binance-only symbols, limiting “other configured sources” support promised in the brief.【F:config/default.json†L1-L118】【F:src/exchanges/index.js†L1-L64】

**Action Items**
1. Extend the exchange abstraction by implementing at least one additional connector (e.g., Coinbase) and update asset configs/tests to validate multi-source ingestion.【F:src/exchanges/index.js†L1-L64】
2. Add integration tests that cross-check generated summaries against indicator values to ensure textual guidance matches chart overlays.【F:src/reporter.js†L1-L88】【F:tests/reporter.test.js†L131-L296】
3. Document indicator parameter overrides per asset/timeframe to help admins fine-tune chart outputs without code changes.【F:README.md†L41-L90】

### 2. Alert Notifications for Price Events
**Observations**
- Alerts are modular, severity-ordered, deduplicated, and logged for auditing, but oscillation handling relies on global cooldowns.【F:src/alerts.js†L22-L131】【F:src/index.js†L520-L724】
- Variation metrics extract higher-timeframe percentage moves for enriched payloads, aligning with the multi-timeframe requirement.【F:src/alerts/variationMetrics.js†L1-L60】【F:src/index.js†L560-L693】

**Action Items**
1. Introduce per-rule hysteresis/cooldown settings to avoid repeated triggers when prices hover around thresholds; expose via config and tests.【F:src/alerts.js†L22-L108】
2. Provide admin-facing tooling (CLI or slash command) to toggle alert modules/thresholds dynamically and persist them through `config/custom.json`.【F:config/default.json†L1-L118】【F:src/alerts.js†L22-L108】
3. Enhance Sheets logging to capture alert cooldown decisions and aggregated context for compliance review.【F:src/controllers/sheetsReporter.js†L1-L140】

### 3. Price Forecasting Module
**Observations**
- Forecasting uses linear regression with history persistence and metrics, and forecast charts are appended to Discord uploads when enabled.【F:src/forecasting.js†L1-L120】【F:src/index.js†L700-L744】

**Action Items**
1. Add error-tracking jobs that periodically evaluate forecast accuracy (MAE/RMSE) and surface metrics to Prometheus for trend monitoring.【F:src/forecasting.js†L63-L119】【F:src/index.js†L256-L288】
2. Document and expose toggles for experimental forecasting per asset/timeframe to meet configurability requirements.【F:README.md†L41-L90】
3. Create backtests comparing the regression forecast against a naive baseline to confirm added value before enabling by default.【F:src/forecasting.js†L1-L120】

### 4. Portfolio Growth Simulation
**Observations**
- The simulation engine reuses market data, applies risk controls, and publishes Discord/Snapshots outputs with logging hooks.【F:src/portfolio/growth.js†L1-L160】【F:src/index.js†L812-L856】

**Action Items**
1. Parameterize scenario inputs (target capital, rebalance cadence, strategies) via CLI/slash command rather than hardcoded defaults.【F:src/portfolio/growth.js†L1-L160】
2. Add regression tests validating CAGR/drawdown calculations using deterministic datasets to protect financial math changes.【F:src/portfolio/growth.js†L30-L159】
3. Extend reporting to include narrative assumptions in Discord/Sheets payloads for compliance transparency.【F:src/controllers/sheetsReporter.js†L79-L140】【F:src/index.js†L812-L856】

### 5. Discord Commands & Market Reports
**Observations**
- Slash command scaffolding exists in `discordBot.js` (not shown) and daily/weekly posts reuse `postAnalysis` logic with PDF exports.【F:src/discord.js†L34-L197】【F:src/index.js†L874-L936】

**Action Items**
1. Audit available slash commands and ensure help text/documentation reflects new forecasting/simulation triggers.【F:README.md†L97-L170】
2. Expand scheduled weekly/monthly reports to include consolidated sentiment/news sections by reusing Kaiban outputs when available.【F:src/ai.js†L313-L330】【F:src/index.js†L874-L936】
3. Implement staging Discord automation tests to validate embed formatting and file attachments across locales.【F:src/discord.js†L120-L197】

### 6. Google Sheets / Excel Logging
**Observations**
- Sheets integration batches writes, enforces structured rows (timestamp, channel, metadata, compliance), and is instrumented with Prometheus counters.【F:src/controllers/sheetsReporter.js†L1-L200】【F:src/googleSheets.js†L1-L120】

**Action Items**
1. Introduce retry backoff configuration and alerting when Sheets quota errors persist to maintain SLA.【F:src/googleSheets.js†L55-L109】
2. Provide schema validation tests for exported rows to guard against regressions when metadata changes.【F:src/controllers/sheetsReporter.js†L79-L140】
3. Build a backfill script leveraging existing queue utilities to migrate historical logs when enabling Sheets mid-stream.【F:src/controllers/sheetsReporter.js†L1-L140】

### 7. Automated Trade Execution via Binance
**Observations**
- Automation maps signals to trade intents, enforces position sizing and exposure limits, and routes through Binance connector abstractions.【F:src/trading/automation.js†L1-L160】【F:src/exchanges/index.js†L1-L64】
- Risk manager merges compliance inputs and computes breaches/decisions with structured metadata for logging.【F:src/trading/riskManager.js†L1-L200】

**Action Items**
1. Add dry-run simulations that replay recent Kaiban decisions through automation to verify order payloads without hitting Binance (unit + integration tests).【F:src/trading/automation.js†L1-L160】
2. Extend connector coverage to futures/other venues to satisfy multi-exchange ambitions while honoring current interface contracts.【F:src/exchanges/index.js†L1-L64】
3. Ensure Sheets/Discord notifications include full compliance context (breaches, scaled sizes) for every executed or blocked trade.【F:src/controllers/sheetsReporter.js†L79-L140】【F:src/trading/riskManager.js†L70-L165】

### 8. Backtesting Engine & Performance Metrics
**Observations**
- Portfolio growth covers some long-horizon simulation needs, but there is no dedicated module computing Sharpe/Sortino for arbitrary strategies yet.【F:src/portfolio/growth.js†L1-L160】

**Action Items**
1. Implement a standalone backtesting runner that replays historical candles using existing signal generators and outputs industry metrics (Sharpe, max drawdown).【F:src/index.js†L183-L744】
2. Add CLI entry points and tests comparing baseline (buy-and-hold) vs strategy to validate calculations.【F:package.json†L1-L120】
3. Surface backtest summaries in documentation and dashboard for transparency and parameter tuning.【F:docs/dashboard.md†L1-L160】【F:src/dashboard/server.js†L1-L160】

### 9. Multi-Asset & Multi-Market Support
**Observations**
- Configuration already enumerates multiple Binance assets, and exchange registry is pluggable but only ships with `binanceConnector`.【F:config/default.json†L1-L118】【F:src/exchanges/index.js†L1-L64】

**Action Items**
1. Generalize asset metadata to capture tick sizes, trading hours, and exchange-specific constraints for new markets.【F:config/default.json†L24-L118】
2. Build connectors/tests for at least one non-crypto market (e.g., equities API) and ensure scheduler respects market hours.【F:src/index.js†L49-L168】【F:src/exchanges/index.js†L1-L64】
3. Update risk calculations to aggregate exposure across exchanges/asset classes when multi-market trading is enabled.【F:src/trading/automation.js†L64-L160】【F:src/trading/riskManager.js†L22-L165】

### 10. Web Dashboard for Monitoring
**Observations**
- Lightweight HTTP server exposes forecasts, charts, trades, and Prometheus metrics but lacks interactive frontend pages beyond JSON/asset listings.【F:src/dashboard/server.js†L1-L160】

**Action Items**
1. Implement a frontend (e.g., React/Vite) consuming `/status` JSON to display signals, alerts, trades, and KPIs in real time.【F:src/dashboard/server.js†L30-L128】
2. Add authentication token checks and rate limiting before exposing the dashboard beyond localhost.【F:src/dashboard/server.js†L14-L40】
3. Integrate charts (price/equity) and alert feeds, reusing existing PNG outputs or exposing new JSON endpoints for client-side rendering.【F:src/dashboard/server.js†L30-L128】【F:src/index.js†L700-L744】

### 11. Compliance & Risk Management Enhancements
**Observations**
- Risk manager merges policies, breaches, and compliance messages but relies on static config; circuit breakers/volatility triggers are placeholders.【F:src/trading/riskManager.js†L22-L200】

**Action Items**
1. Implement dynamic risk monitoring that halts automation when drawdowns or volatility thresholds breach configured limits, publishing Discord alerts when triggered.【F:src/trading/automation.js†L1-L160】【F:src/trading/riskManager.js†L22-L200】
2. Extend compliance metadata exported to Sheets and Discord to include policy references and remediation advice.【F:src/controllers/sheetsReporter.js†L79-L140】
3. Provide tooling to test risk policy scenarios (unit tests & CLI) ensuring blocked trades surface clear justification strings.【F:tests/trading/riskManager.test.js†L1-L200】

### 12. Multi-Agent AI Team Architecture
**Observations**
- Kaiban workflow already orchestrates technical, news, sentiment, research, trader, risk, and execution agents with schema validation and tests.【F:src/agents/team.js†L320-L404】【F:tests/agents/team.test.js†L304-L343】

**Action Items**
1. Capture cost/latency metrics per agent run and expose them via Prometheus to optimize model selection and concurrency.【F:src/agents/team.js†L320-L404】【F:src/index.js†L256-L288】
2. Implement persistence of agent outputs to the RAG/vector store for auditability and knowledge reuse.【F:src/agents/team.js†L360-L404】【F:src/vectorStore.js†L1-L160】
3. Provide fallback mini-prompts for each agent to degrade gracefully when OpenRouter is unavailable, avoiding total loss of decision context.【F:src/ai.js†L313-L330】

### 13. Specialized AI Agents for Trading Roles
**Observations**
- Role modules define prompts/output schemas for technical/news/sentiment/research/trader/risk/execution tasks, enforcing structured JSON results.【F:src/agents/roles/trader.js†L1-L80】【F:src/agents/roles/execution.js†L1-L80】

**Action Items**
1. Calibrate prompts with real market transcripts and add evaluation harnesses comparing bull/bear researcher outputs to ground-truth scenarios.【F:src/agents/roles/research.js†L1-L160】
2. Introduce deterministic agents (code-based) for technical/risk roles where LLM variability is unnecessary, reserving LLM calls for qualitative tasks.【F:src/agents/roles/technical.js†L1-L200】【F:src/agents/roles/risk.js†L1-L160】
3. Maintain a library of sample multi-agent cycles (fixtures) for regression testing debate quality and trader decisions.【F:tests/agents/team.test.js†L304-L343】

### 14. Final Decision Output & Distribution
**Observations**
- Execution agent returns Markdown plus structured decisions, which flow into daily reports but lack dedicated Discord summary posts aggregating stance/justification per asset.【F:src/agents/roles/execution.js†L1-L80】【F:src/ai.js†L313-L330】【F:src/index.js†L874-L936】

**Action Items**
1. Build a final decision broadcaster that posts Kaiban execution summaries to configured Discord channels and logs them in Sheets with compliance context.【F:src/agents/roles/execution.js†L16-L68】【F:src/controllers/sheetsReporter.js†L79-L140】
2. Ensure trading automation consumes the execution payload (stance, conviction, position size) directly rather than relying on separate heuristics.【F:src/trading/automation.js†L1-L160】【F:src/agents/roles/trader.js†L1-L80】
3. Add failure handling when any agent output is missing—post a neutral “insufficient data” message while alerting operators.【F:src/agents/team.js†L360-L404】【F:src/index.js†L874-L940】

---
Track progress against these items in the planning board and update this audit as connectors, dashboards, or compliance features evolve.
