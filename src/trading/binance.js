/**
 * Binance adapter consolidando requisições autenticadas, consulta de contas e utilidades
 * de stream utilizadas pelo executor automático e pelos relatórios de carteira.
 *
 * Além de assinar requests privadas com HMAC, o módulo formata saldos spot/margin,
 * calcula preço médio de fills e exporta helpers consumidos pelo comando `/binance`
 * e pelo simulador de crescimento de portfólio.
 */
import axios from "axios";
import crypto from "crypto";
import WebSocket from "ws";
import { logTrade } from "./tradeLog.js";
import { logger, withContext } from "../logger.js";
import { fetchWithRetry } from "../utils.js";

const BASE = "https://api.binance.com";
const FUTURES_BASE = "https://fapi.binance.com";
const WS_BASE = "wss://stream.binance.com:9443/ws";
const DEFAULT_RECV_WINDOW = Number.parseInt(process.env.BINANCE_RECV_WINDOW ?? "5000", 10);

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
            log.info({ method, attempt }, 'Dispatching Binance private request');
            const startedAt = Date.now();
            try {
                const response = await axios({ method, url, headers: { "X-MBX-APIKEY": key } });
                const durationMs = Date.now() - startedAt;
                log.debug({ method, attempt, status: response?.status, durationMs }, 'Binance private request completed');
                return response;
            } catch (err) {
                const durationMs = Date.now() - startedAt;
                log.debug({ method, attempt, status: err?.response?.status, durationMs }, 'Binance private request failed');
                throw err;
            }
        });
        return data;
    } catch (err) {
        log.error({ method, status: err?.response?.status }, 'Binance request failed');
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
                total
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
                netAsset
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
        .filter(entry => includeZero || entry.balance !== 0 || entry.availableBalance !== 0 || entry.crossWalletBalance !== 0 || entry.crossUnrealizedPnl !== 0 || entry.maxWithdrawAmount !== 0);
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

export async function submitOrder({
    symbol,
    side,
    type = "MARKET",
    quantity,
    price,
    params = {},
} = {}, { context } = {}) {
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

export async function getSpotBalances(options = {}) {
    const data = await privateRequest("GET", "/api/v3/account", {}, { context: { scope: "spot" } });
    return mapBalances(data?.balances, options);
}

export async function getBalances(options = {}) {
    return getSpotBalances(options);
}

export async function getAccountAssets() {
    return privateRequest("GET", "/sapi/v1/capital/config/getall", {}, { context: { scope: "accountAssets" } });
}

export async function getMarginAccount(options = {}) {
    const data = await privateRequest("GET", "/sapi/v1/margin/account", {}, { context: { scope: "margin" } });
    return {
        ...data,
        totalAssetOfBtc: toNumber(data?.totalAssetOfBtc),
        totalLiabilityOfBtc: toNumber(data?.totalLiabilityOfBtc),
        totalNetAssetOfBtc: toNumber(data?.totalNetAssetOfBtc),
        marginLevel: toNumber(data?.marginLevel),
        userAssets: mapMarginAssets(data?.userAssets, options)
    };
}

export async function getMarginPositionRisk({ symbol } = {}) {
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
            marginType: position.marginType
        }))
        : [];
}

export async function getUsdFuturesBalances(options = {}) {
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
    withContext(logger, context).warn({ fn: "getAccountOverview", status, code, message }, 'Failed to load Binance section');
}

export async function getAccountOverview(options = {}) {
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

export async function placeMarketOrder(symbol, side, quantity, params = {}) {
    return submitOrder({ symbol, side, type: "MARKET", quantity, params });
}

export async function placeLimitOrder(symbol, side, quantity, price, params = {}) {
    return submitOrder({
        symbol,
        side,
        type: "LIMIT",
        quantity,
        price,
        params: { timeInForce: "GTC", ...params },
    });
}

export function subscribeTicker(symbol, onMessage) {
    const stream = `${symbol.toLowerCase()}@ticker`;
    const ws = new WebSocket(`${WS_BASE}/${stream}`);
    ws.on("message", msg => {
        try {
            const data = JSON.parse(msg);
            onMessage?.(data);
        } catch (e) {
            withContext(logger, { asset: symbol }).error({ fn: 'subscribeTicker', err: e }, "WS parse error");
        }
    });
    return ws;
}

function ensurePositiveAmount(amount) {
    const parsed = Number.parseFloat(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("Invalid margin amount");
    }
    return parsed.toString();
}

export async function transferMargin({ asset, amount, direction = "toMargin" } = {}) {
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

export async function borrowMargin({ asset, amount } = {}) {
    if (!asset) {
        throw new Error("Missing asset for margin borrow");
    }
    const normalizedAmount = ensurePositiveAmount(amount);
    return privateRequest("POST", "/sapi/v1/margin/loan", {
        asset,
        amount: normalizedAmount,
    }, { context: { scope: "marginBorrow", asset } });
}

export async function repayMargin({ asset, amount } = {}) {
    if (!asset) {
        throw new Error("Missing asset for margin repay");
    }
    const normalizedAmount = ensurePositiveAmount(amount);
    return privateRequest("POST", "/sapi/v1/margin/repay", {
        asset,
        amount: normalizedAmount,
    }, { context: { scope: "marginRepay", asset } });
}
