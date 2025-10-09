import http from "http";
import { existsSync, statSync, createReadStream } from "fs";
import path from "path";
import { CFG } from "../config.js";
import { logger, withContext } from "../logger.js";
import { register } from "../metrics.js";
import { getForecastSnapshots, getAlertHistory } from "../store.js";
import { getTradeHistory } from "../trading/tradeLog.js";

const JSON_CONTENT_TYPE = "application/json";
const TEXT_CONTENT_TYPE = "text/plain";

function buildDashboardOptions() {
    const cfg = CFG.dashboard ?? {};
    const enabled = cfg.enabled !== false;
    const port = Number.isInteger(cfg.port) && cfg.port > 0 ? cfg.port : 3100;
    const token = typeof cfg.token === "string" && cfg.token.trim() !== ""
        ? cfg.token.trim()
        : "local-dev-token";
    return { enabled, port, token };
}

function sendJson(res, statusCode, payload) {
    const body = JSON.stringify(payload);
    res.statusCode = statusCode;
    res.setHeader("Content-Type", JSON_CONTENT_TYPE);
    res.setHeader("Content-Length", Buffer.byteLength(body));
    res.end(body);
}

function sendText(res, statusCode, payload) {
    res.statusCode = statusCode;
    res.setHeader("Content-Type", TEXT_CONTENT_TYPE);
    res.end(payload);
}

function collectAssets() {
    const assets = Array.isArray(CFG.assets) ? CFG.assets : [];
    const forecasts = getForecastSnapshots();
    const chartDir = path.resolve(process.cwd(), "charts");
    return assets.map(asset => {
        const key = asset?.key ?? null;
        const snapshot = key && forecasts[key] ? forecasts[key] : {};
        const chartPaths = [];
        if (key) {
            const prefixes = [path.join("forecasts", `${key}.png`), path.join("forecasts", `${key}.webp`)];
            for (const relative of prefixes) {
                const filePath = path.join(chartDir, relative);
                if (existsSync(filePath)) {
                    chartPaths.push(`/uploads/charts/${relative}`);
                }
            }
        }
        return {
            key,
            exchange: asset?.exchange ?? null,
            symbol: asset?.symbol ?? null,
            metadata: asset?.metadata ?? {},
            capabilities: asset?.capabilities ?? {},
            marketCapRank: asset?.marketCapRank ?? null,
            forecasts: snapshot,
            chartPaths,
        };
    });
}

function computePortfolioStats() {
    const trades = getTradeHistory();
    if (!Array.isArray(trades) || trades.length === 0) {
        return {
            totalTrades: 0,
            openPositions: [],
            realizedPnl: 0,
            winRate: 0,
            accountEquity: CFG.accountEquity ?? 0,
            exposure: 0,
            closedTrades: [],
            lastTrade: null,
        };
    }
    const openPositions = [];
    const closedTrades = [];
    let realizedPnl = 0;
    let wins = 0;
    let losses = 0;
    let exposure = 0;
    for (const trade of trades) {
        const quantity = Number.parseFloat(trade?.quantity ?? trade?.qty);
        const price = Number.parseFloat(trade?.entry);
        const notional = Number.isFinite(price) && Number.isFinite(quantity)
            ? Math.abs(price * quantity)
            : 0;
        if (trade?.closedAt) {
            const pnl = Number.parseFloat(trade?.pnl);
            if (Number.isFinite(pnl)) {
                realizedPnl += pnl;
                if (pnl > 0) {
                    wins += 1;
                } else if (pnl < 0) {
                    losses += 1;
                }
            }
            closedTrades.push({
                id: trade?.id ?? null,
                symbol: trade?.symbol ?? null,
                entry: price,
                exit: Number.isFinite(trade?.exit) ? Number(trade.exit) : null,
                pnl: Number.isFinite(trade?.pnl) ? Number(trade.pnl) : null,
                closedAt: trade.closedAt,
                side: trade?.side ?? null,
            });
        } else {
            if (notional > 0) {
                exposure += notional;
            }
            openPositions.push({
                id: trade?.id ?? null,
                symbol: trade?.symbol ?? null,
                side: trade?.side ?? null,
                quantity: Number.isFinite(quantity) ? quantity : null,
                entry: price,
                timestamp: trade?.timestamp ?? null,
            });
        }
    }
    const totalClosed = wins + losses;
    const winRate = totalClosed > 0 ? wins / totalClosed : 0;
    const lastTrade = trades
        .slice()
        .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
        .map(entry => ({
            id: entry?.id ?? null,
            symbol: entry?.symbol ?? null,
            side: entry?.side ?? null,
            timestamp: entry?.timestamp ?? null,
            closedAt: entry?.closedAt ?? null,
            pnl: Number.isFinite(entry?.pnl) ? Number(entry.pnl) : null,
        }))
        .at(0) ?? null;
    return {
        totalTrades: trades.length,
        openPositions,
        closedTrades,
        realizedPnl,
        winRate,
        accountEquity: CFG.accountEquity ?? 0,
        exposure,
        lastTrade,
    };
}

async function buildHealthPayload() {
    const metrics = await register.getMetricsAsJSON();
    return {
        uptime: process.uptime(),
        pid: process.pid,
        memory: process.memoryUsage(),
        metrics,
        timestamp: Date.now(),
    };
}

function isAuthenticated(req, token) {
    if (!token) {
        return true;
    }
    const header = req.headers?.authorization;
    if (typeof header === "string") {
        const [scheme, value] = header.split(" ");
        if (scheme?.toLowerCase() === "bearer" && value === token) {
            return true;
        }
    }
    const url = new URL(req.url ?? "", "http://localhost");
    const queryToken = url.searchParams.get("token");
    return queryToken === token;
}

async function parseJsonBody(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(chunk);
    }
    if (chunks.length === 0) {
        return {};
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
        return {};
    }
}

function handleStaticAsset(res, baseDir, relativePath) {
    const normalized = relativePath.replace(/^\/+/, "");
    const filePath = path.join(baseDir, normalized);
    const resolvedBase = path.resolve(baseDir);
    const resolvedFile = path.resolve(filePath);
    if (!resolvedFile.startsWith(resolvedBase)) {
        sendText(res, 403, "Forbidden");
        return;
    }
    if (!existsSync(resolvedFile)) {
        sendText(res, 404, "Not Found");
        return;
    }
    const stats = statSync(resolvedFile);
    if (!stats.isFile()) {
        sendText(res, 404, "Not Found");
        return;
    }
    const stream = createReadStream(resolvedFile);
    res.statusCode = 200;
    res.setHeader("Content-Length", stats.size);
    if (resolvedFile.endsWith(".png")) {
        res.setHeader("Content-Type", "image/png");
    } else if (resolvedFile.endsWith(".jpg") || resolvedFile.endsWith(".jpeg")) {
        res.setHeader("Content-Type", "image/jpeg");
    } else if (resolvedFile.endsWith(".webp")) {
        res.setHeader("Content-Type", "image/webp");
    } else if (resolvedFile.endsWith(".svg")) {
        res.setHeader("Content-Type", "image/svg+xml");
    } else {
        res.setHeader("Content-Type", "application/octet-stream");
    }
    stream.pipe(res);
}

function enableCors(res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

export function startDashboardServer(overrides = {}) {
    const base = buildDashboardOptions();
    const options = { ...base };
    if (Object.prototype.hasOwnProperty.call(overrides, "enabled")) {
        options.enabled = overrides.enabled;
    }
    if (Object.prototype.hasOwnProperty.call(overrides, "port")) {
        options.port = overrides.port;
    }
    if (Object.prototype.hasOwnProperty.call(overrides, "token")) {
        options.token = overrides.token;
    }
    const log = withContext(logger, { fn: "dashboardServer" });
    if (!options.enabled) {
        log.info("Dashboard server disabled by configuration");
        return null;
    }
    const listenPort = Number.isInteger(options.port) ? options.port : base.port;
    const server = http.createServer(async (req, res) => {
        enableCors(res);
        if (req.method === "OPTIONS") {
            res.statusCode = 204;
            res.end();
            return;
        }
        try {
            const url = new URL(req.url ?? "", "http://localhost");
            if (url.pathname === "/api/auth/login" && req.method === "POST") {
                const body = await parseJsonBody(req);
                if (body?.token && body.token === options.token) {
                    sendJson(res, 200, { ok: true, token: body.token });
                } else {
                    sendJson(res, 401, { ok: false, error: "Invalid token" });
                }
                return;
            }
            if (!isAuthenticated(req, options.token)) {
                sendJson(res, 401, { error: "Unauthorized" });
                return;
            }
            if (url.pathname === "/api/assets" && req.method === "GET") {
                const assets = collectAssets();
                sendJson(res, 200, { assets, timestamp: Date.now() });
                return;
            }
            if (url.pathname === "/api/alerts" && req.method === "GET") {
                const limit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
                const alerts = getAlertHistory({ limit });
                sendJson(res, 200, { alerts, timestamp: Date.now() });
                return;
            }
            if (url.pathname === "/api/portfolio" && req.method === "GET") {
                const portfolio = computePortfolioStats();
                sendJson(res, 200, { portfolio, timestamp: Date.now() });
                return;
            }
            if (url.pathname === "/api/health" && req.method === "GET") {
                const health = await buildHealthPayload();
                sendJson(res, 200, health);
                return;
            }
            if (url.pathname.startsWith("/uploads/charts/") && req.method === "GET") {
                const relative = url.pathname.replace("/uploads/charts/", "");
                const baseDir = path.resolve(process.cwd(), "charts");
                handleStaticAsset(res, baseDir, relative);
                return;
            }
            sendJson(res, 404, { error: "Not Found" });
        } catch (error) {
            log.error({ err: error }, "Dashboard request failed");
            sendJson(res, 500, { error: "Internal error" });
        }
    });
    return new Promise((resolve) => {
        server.listen(listenPort, () => {
            const address = server.address();
            const actualPort = typeof address === "object" && address !== null ? address.port : listenPort;
            log.info({ port: actualPort }, "Dashboard server listening");
            resolve(server);
        });
    });
}
