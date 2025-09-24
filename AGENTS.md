# Repository Guidelines

## Project Structure & Module Organization
- `src/` contains bot modules (alerts, AI, data, reporters) with `index.js` as entrypoint.
- `tests/` mirrors `src` for Vitest suites and fixtures; mirror that layout when adding suites.
- `bin/` hosts operational scripts such as `config-cli.js` and report cleanup utilities.
- Generated artifacts belong in `logs/`, `reports/`, `charts/`, and `coverage/`; documentation builds land in `docs/` and `website/docs`.
- Configuration defaults live in `config/default.json`; override with `.env` or `npx config-cli`.

## Build, Test & Development Commands
- `npm run start` runs the scheduled bot; `npm run once` executes a single cycle.
- `npm run test` runs Vitest; add `-- --watch` for iterative debugging.
- `npm run test:coverage` generates V8 reports; `npm run test:chart` refreshes `reports/charts`.
- `npm run docs` refreshes JSDoc; `npm run site:dev`, `site:build`, and `site:preview` manage the VitePress docs site.

## Coding Style & Naming Conventions
- Use ESM syntax, 4-space indentation, and trailing semicolons throughout.
- Filenames stay lowerCamelCase (`weeklySnapshots.js`), exported constants use `UPPER_SNAKE_CASE`, and functions remain lowerCamelCase.
- Prefer double quotes for imports and configuration literals, single quotes for log strings as seen in `src/index.js`.
- Inject dependencies through helpers like `CFG`; avoid adding globals.

## Testing Guidelines
- Place `.test.js` files under `tests/` mirroring the module under test; mock network and Discord calls.
- Focus assertions on behavior and log outputs; reset timers when verifying cron flows.
- Run `npm run test:coverage` before PRs and note intentional gaps in the description.

## Commit & Pull Request Guidelines
- Write imperative commit subjects that mirror history (e.g., `Ensure logger uses sync transport on Windows`).
- Reference issues or alerts in the subject and squash noisy WIP commits before pushing.
- PRs should outline behavior changes, list verification steps (`npm run test`, chart screenshots), and flag config or secret updates.
- Tag maintainers for affected domains (alerts, AI, data) and wait for green CI before merging.

## Environment & Secrets
- Copy `.env.example` to `.env`; validate tokens with `npx config-cli` and keep secrets out of version control.
- Clear or ignore generated content in `logs/`, `reports/`, and `data/` before opening a PR.
- When running locally, monitor structured logs and Prometheus metrics at `http://localhost:3001/metrics` for regressions.
