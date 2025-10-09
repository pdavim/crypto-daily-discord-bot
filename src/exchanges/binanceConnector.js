import axios from "axios";
import crypto from "crypto";
import WebSocket from "ws";
import { performance } from "node:perf_hooks";
import { LRUCache } from "lru-cache";

import { fetchWithRetry } from "../utils.js";
import { CFG, onConfigChange } from "../config.js";
import { logger, withContext } from "../logger.js";
import { recordPerf } from "../perf.js";
import { logTrade } from "../trading/tradeLog.js";

const BASE = "https://api.binance.com";
const DATA_BASE = `${BASE}/api/v3/klines`;
const FUTURES_BASE = "https://fapi.binance.com";
const WS_BASE = "wss://stream.binance.com:9443/ws";
const DEFAULT_RECV_WINDOW = Number.parseInt(process.env.BINANCE_RECV_WINDOW ?? "5000", 10);
const DEFAULT_LIMIT = 200;
const RATE_LIMIT_MS = 200;

let lastCall = 0;
let binanceOffline = false;

function getCacheTtlMs() {
    const ttlMinutes = Number.parseFloat(CFG.binanceCacheTTL ?? "");
    if (Number.isFinite(ttlMinutes) && ttlMinutes > 0) {
        return ttlMinutes * 60 * 1000;
    }
    return 10 * 60 * 1000;
}

const cache = new LRUCache({
    max: 500,
    ttl: getCacheTtlMs(),
});

onConfigChange(() => {
    cache.ttl = getCacheTtlMs();
});

function markOffline(err) {
    const aggregateErrors = Array.isArray(err?.errors) ? err.errors : [];
    const codes = [err?.code, ...aggregateErrors.map(e => e?.code)].filter(Boolean);
    if (codes.includes("ENETUNREACH")) {
        binanceOffline = true;
    }
}

async function rateLimit() {
    const now = Date.now();
    const wait = Math.max(0, lastCall + RATE_LIMIT_MS - now);
    if (wait > 0) {
        await new Promise(resolve => setTimeout(resolve, wait));
    }
    lastCall = Date.now();
}

function getCredentials() {
    const key = process.env.BINANCE_API_KEY?.trim();
    const secret = process.env.BINANCE_SECRET?.trim();
    if (!key || !secret) {
        throw new Error("Missing Binance API credentials");
    }
    return { key, secret };
}

function sign(params, secret) {
    const query = new URLSearchParams(params).toString();
    const signature = crypto.createHmac("sha256", secret).update(query).digest("hex");
    return `${query}&signature=${signature}`;
}

async function privateRequest(method, path, params = {}, { context, baseUrl = BASE } = {}) {
    const { key, secret } = getCredentials();
    const timestamp = Date.now();
    const recvWindow = Number.isFinite(DEFAULT_RECV_WINDOW) ? DEFAULT_RECV_WINDOW : 5000;
    const payload = {
        ...params,
        timestamp,
        ...(params.recvWindow ? {} : { recvWindow })
    };

    const qs = sign(payload, secret);
    const url = `${baseUrl}${path}?${qs}`;
    const log = withContext(logger, { ...context, exchange: "binance", path, fn: "privateRequest" });
    let attempt = 0;
    try {
        const { data } = await fetchWithRetry(async () => {
            attempt += 1;
            log.info({ method, attempt }, "Dispatching Binance private request");
            const startedAt = Date.now();
            try {
                const response = await axios({ method, url, headers: { "X-MBX-APIKEY": key } });
                const durationMs = Date.now() - startedAt;
                log.debug({ method, attempt, status: response?.status, durationMs }, "Binance private request completed");
                return response;
            } catch (err) {
                const durationMs = Date.now() - startedAt;
                log.debug({ method, attempt, status: err?.response?.status, durationMs }, "Binance private request failed");
                throw err;
            }
        });
        return data;
    } catch (err) {
        log.error({ method, status: err?.response?.status }, "Binance request failed");
        throw err;
    }
}

function toNumber(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function mapBalances(balances = [], { includeZero = false } = {}) {
    return balances
        .map(balance => {
            const free = toNumber(balance.free);
            const locked = toNumber(balance.locked);
            const total = free + locked;
            return {
                asset: balance.asset,
                free,
                locked,
                total,
            };
        })
        .filter(entry => includeZero || entry.total > 0);
}

function mapMarginAssets(userAssets = [], { includeZero = false } = {}) {
    return userAssets
        .map(asset => {
            const free = toNumber(asset.free);
            const borrowed = toNumber(asset.borrowed);
            const interest = toNumber(asset.interest);
            const netAsset = toNumber(asset.netAsset);
            return {
                asset: asset.asset,
                free,
                borrowed,
                interest,
                netAsset,
            };
        })
        .filter(entry => includeZero || entry.netAsset !== 0 || entry.free !== 0 || entry.borrowed !== 0 || entry.interest !== 0);
}

function mapFuturesBalances(balances = [], { includeZero = false } = {}) {
    return balances
        .map(balance => {
            const walletBalance = toNumber(balance.balance);
            const availableBalance = toNumber(balance.availableBalance);
            const crossWalletBalance = toNumber(balance.crossWalletBalance);
            const crossUnrealizedPnl = toNumber(balance.crossUnPnl);
            const maxWithdrawAmount = toNumber(balance.maxWithdrawAmount);
            return {
                asset: balance.asset,
                balance: walletBalance,
                availableBalance,
                crossWalletBalance,
                crossUnrealizedPnl,
                maxWithdrawAmount,
            };
        })
        .filter(entry => includeZero
            || entry.balance !== 0
            || entry.availableBalance !== 0
            || entry.crossWalletBalance !== 0
            || entry.crossUnrealizedPnl !== 0
            || entry.maxWithdrawAmount !== 0);
}

function computeAverageFillPrice(fills = []) {
    if (!Array.isArray(fills) || fills.length === 0) {
        return null;
    }

    let totalQty = 0;
    let totalQuote = 0;
    for (const fill of fills) {
        const qty = toNumber(fill.qty);
        const price = toNumber(fill.price);
        if (qty <= 0 || price <= 0) {
            continue;
        }
        totalQty += qty;
        totalQuote += qty * price;
    }

    if (totalQty <= 0) {
        return null;
    }

    return totalQuote / totalQty;
}

function extractFillPrice(data, fallbackPrice) {
    const price = computeAverageFillPrice(data?.fills);
    if (price !== null) {
        return price;
    }

    const responsePrice = toNumber(data?.price);
    if (Number.isFinite(responsePrice) && responsePrice > 0) {
        return responsePrice;
    }

    return Number.isFinite(fallbackPrice) && fallbackPrice > 0 ? fallbackPrice : null;
}

async function fetchCandles({ symbol, interval, limit = DEFAULT_LIMIT }) {
    if (!symbol || !interval) {
        throw new Error("Missing symbol or interval");
    }
    if (binanceOffline) {
        throw new Error("Binance API unavailable");
    }
    const start = performance.now();
    const cacheKey = `ohlcv:${symbol}:${interval}:${limit}`;
    const cached = cache.get(cacheKey);
    if (cached) {
        const ms = performance.now() - start;
        recordPerf("fetchOHLCV", ms);
        return cached;
    }
    const log = withContext(logger, { asset: symbol, timeframe: interval });
    log.info({ fn: "fetchCandles" }, `Fetching OHLCV for ${symbol} ${interval}`);
    const url = `${DATA_BASE}?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    try {
        const { data } = await fetchWithRetry(async () => {
            await rateLimit();
            return axios.get(url);
        });
        if (CFG.debug) {
            log.info({ fn: "fetchCandles", data }, "OHLCV data");
        }
        const result = data.map(c => ({
            t: new Date(c[0]),
            o: +c[1],
            h: +c[2],
            l: +c[3],
            c: +c[4],
            v: +c[5],
        }));
        cache.set(cacheKey, result, { ttl: getCacheTtlMs() });
        const ms = performance.now() - start;
        recordPerf("fetchOHLCV", ms);
        return result;
    } catch (err) {
        markOffline(err);
        throw err;
    }
}

async function fetchDailyCloses({ symbol, days = 32 }) {
    if (!symbol) {
        throw new Error("Missing symbol");
    }
    if (binanceOffline) {
        throw new Error("Binance API unavailable");
    }
    const cacheKey = `daily:${symbol}:${days}`;
    const cached = cache.get(cacheKey);
    if (cached) {
        return cached;
    }
    const log = withContext(logger, { asset: symbol, timeframe: "1d" });
    log.info({ fn: "fetchDailyCloses" }, `Fetching daily closes for ${symbol} last ${days} days`);
    const url = `${DATA_BASE}?symbol=${symbol}&interval=1d&limit=${days}`;
    try {
        const { data } = await fetchWithRetry(async () => {
            await rateLimit();
            return axios.get(url);
        });
        if (CFG.debug) {
            log.info({ fn: "fetchDailyCloses", data }, "Daily closes data");
        }
        const result = data.map(c => ({ t: new Date(c[0]), c: +c[4], v: +c[5] }));
        cache.set(cacheKey, result, { ttl: getCacheTtlMs() });
        return result;
    } catch (err) {
        markOffline(err);
        throw err;
    }
}

function streamCandles(pairs, onCandleClose) {
    if (!Array.isArray(pairs) || pairs.length === 0) {
        return null;
    }
    const streams = pairs.map(({ symbol, interval }) => `${symbol.toLowerCase()}@kline_${interval}`);
    const ws = new WebSocket(`${WS_BASE}/${streams.join("/")}`);
    ws.on("message", (msg) => {
        try {
            const { data } = JSON.parse(msg);
            if (data?.k?.x) {
                onCandleClose?.(data.s, data.k.i);
            }
        } catch (e) {
            withContext(logger).error({ fn: "streamCandles", err: e }, "[BinanceWS] parse error");
        }
    });
    ws.on("error", err => {
        withContext(logger).error({ fn: "streamCandles", err }, "[BinanceWS] error");
    });
    ws.on("close", () => {
        withContext(logger).warn({ fn: "streamCandles" }, "[BinanceWS] connection closed");
    });
    return ws;
}

async function placeOrder({ symbol, side, type = "MARKET", quantity, price, params = {} } = {}, { context } = {}) {
    if (!symbol || !side) {
        throw new Error("Missing required order parameters");
    }
    const payload = {
        symbol,
        side,
        type,
        ...params,
    };
    if (quantity !== undefined) {
        payload.quantity = quantity;
    }
    if (price !== undefined && type !== "MARKET") {
        payload.price = price;
    }
    const orderContext = {
        scope: "order",
        symbol,
        side,
        type,
        ...context,
    };
    const data = await privateRequest("POST", "/api/v3/order", payload, { context: orderContext });
    const fillPrice = extractFillPrice(data, price);
    logTrade({ id: data.orderId, symbol, side, quantity, entry: fillPrice, type });
    return { ...data, fillPrice };
}

async function getSpotBalances(options = {}) {
    const data = await privateRequest("GET", "/api/v3/account", {}, { context: { scope: "spot" } });
    return mapBalances(data?.balances, options);
}

async function getBalances(options = {}) {
    return getSpotBalances(options);
}

async function getAccountAssets() {
    return privateRequest("GET", "/sapi/v1/capital/config/getall", {}, { context: { scope: "accountAssets" } });
}

async function getMarginAccount(options = {}) {
    const data = await privateRequest("GET", "/sapi/v1/margin/account", {}, { context: { scope: "margin" } });
    return {
        ...data,
        totalAssetOfBtc: toNumber(data?.totalAssetOfBtc),
        totalLiabilityOfBtc: toNumber(data?.totalLiabilityOfBtc),
        totalNetAssetOfBtc: toNumber(data?.totalNetAssetOfBtc),
        marginLevel: toNumber(data?.marginLevel),
        userAssets: mapMarginAssets(data?.userAssets, options),
    };
}

async function getMarginPositionRisk({ symbol } = {}) {
    const params = symbol ? { symbol } : {};
    const data = await privateRequest("GET", "/sapi/v1/margin/positionRisk", params, { context: { scope: "marginPosition" } });
    return Array.isArray(data)
        ? data.map(position => ({
            symbol: position.symbol,
            positionAmt: toNumber(position.positionAmt),
            entryPrice: toNumber(position.entryPrice),
            markPrice: toNumber(position.markPrice),
            unrealizedProfit: toNumber(position.unRealizedProfit),
            liquidationPrice: toNumber(position.liquidationPrice),
            marginType: position.marginType,
        }))
        : [];
}

async function getUsdFuturesBalances(options = {}) {
    const data = await privateRequest("GET", "/fapi/v2/balance", {}, {
        context: { scope: "usdMFutures" },
        baseUrl: FUTURES_BASE,
    });
    return mapFuturesBalances(data, options);
}

function logAccountSectionFailure(section, err) {
    const context = { scope: "accountOverview", section };
    const status = err?.response?.status;
    const code = err?.response?.data?.code ?? err?.code;
    const message = err?.message;
    withContext(logger, context).warn({ fn: "getAccountOverview", status, code, message }, "Failed to load Binance section");
}

async function getAccountOverview(options = {}) {
    const tasks = [
        { key: "assets", loader: () => getAccountAssets() },
        { key: "spotBalances", loader: () => getSpotBalances(options.spot) },
        { key: "marginAccount", loader: () => getMarginAccount(options.margin) },
        { key: "marginPositions", loader: () => getMarginPositionRisk(options.positions) },
        { key: "futuresBalances", loader: () => getUsdFuturesBalances(options.futures) },
    ];

    const overview = {
        assets: [],
        spotBalances: [],
        marginAccount: null,
        marginPositions: [],
        futuresBalances: [],
    };

    const results = await Promise.allSettled(tasks.map(task => task.loader()));
    let fatalError = null;
    let successCount = 0;

    results.forEach((result, index) => {
        const { key } = tasks[index];
        if (result.status === "fulfilled") {
            const value = result.value;
            overview[key] = value ?? overview[key];
            successCount += 1;
        } else {
            const error = result.reason;
            if (!fatalError && error instanceof Error && error.message.includes("Missing Binance API credentials")) {
                fatalError = error;
            }
            logAccountSectionFailure(key, error);
        }
    });

    if (fatalError) {
        throw fatalError;
    }

    if (successCount === 0) {
        const fallbackError = results.find(entry => entry.status === "rejected")?.reason;
        if (fallbackError) {
            throw fallbackError;
        }
        throw new Error("Failed to load Binance account overview");
    }

    return overview;
}

function ensurePositiveAmount(amount) {
    const parsed = Number.parseFloat(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("Invalid margin amount");
    }
    return parsed.toString();
}

async function transferMargin({ asset, amount, direction = "toMargin" } = {}) {
    if (!asset) {
        throw new Error("Missing asset for margin transfer");
    }
    const normalizedAmount = ensurePositiveAmount(amount);
    const type = direction === "toSpot" ? 2 : 1;
    return privateRequest("POST", "/sapi/v1/margin/transfer", {
        asset,
        amount: normalizedAmount,
        type,
    }, { context: { scope: "marginTransfer", asset, direction } });
}

async function borrowMargin({ asset, amount } = {}) {
    if (!asset) {
        throw new Error("Missing asset for margin borrow");
    }
    const normalizedAmount = ensurePositiveAmount(amount);
    return privateRequest("POST", "/sapi/v1/margin/loan", {
        asset,
        amount: normalizedAmount,
    }, { context: { scope: "marginBorrow", asset } });
}

async function repayMargin({ asset, amount } = {}) {
    if (!asset) {
        throw new Error("Missing asset for margin repay");
    }
    const normalizedAmount = ensurePositiveAmount(amount);
    return privateRequest("POST", "/sapi/v1/margin/repay", {
        asset,
        amount: normalizedAmount,
    }, { context: { scope: "marginRepay", asset } });
}

function placeMarketOrder(symbol, side, quantity, params = {}) {
    return placeOrder({ symbol, side, type: "MARKET", quantity, params });
}

function placeLimitOrder(symbol, side, quantity, price, params = {}) {
    return placeOrder({
        symbol,
        side,
        type: "LIMIT",
        quantity,
        price,
        params: { timeInForce: "GTC", ...params },
    });
}

function subscribeTicker(symbol, onMessage) {
    const stream = `${symbol.toLowerCase()}@ticker`;
    const ws = new WebSocket(`${WS_BASE}/${stream}`);
    ws.on("message", msg => {
        try {
            const data = JSON.parse(msg);
            onMessage?.(data);
        } catch (e) {
            withContext(logger, { asset: symbol }).error({ fn: "subscribeTicker", err: e }, "WS parse error");
        }
    });
    return ws;
}

export const binanceConnector = {
    id: "binance",
    metadata: {
        name: "Binance",
    },
    fetchCandles,
    fetchDailyCloses,
    streamCandles,
    placeOrder,
    placeMarketOrder,
    placeLimitOrder,
    getBalances,
    getSpotBalances,
    getAccountAssets,
    getMarginAccount,
    getMarginPositionRisk,
    getUsdFuturesBalances,
    getAccountOverview,
    transferMargin,
    borrowMargin,
    repayMargin,
    subscribeTicker,
};

export default binanceConnector;
