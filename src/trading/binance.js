import axios from "axios";
import crypto from "crypto";
import WebSocket from "ws";
import { logTrade } from "./tradeLog.js";
import { logger, withContext } from "../logger.js";

const BASE = "https://api.binance.com";
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

async function privateRequest(method, path, params = {}, { context } = {}) {
    const { key, secret } = getCredentials();
    const timestamp = Date.now();
    const recvWindow = Number.isFinite(DEFAULT_RECV_WINDOW) ? DEFAULT_RECV_WINDOW : 5000;
    const payload = {
        ...params,
        timestamp,
        ...(params.recvWindow ? {} : { recvWindow })
    };

    const qs = sign(payload, secret);
    const url = `${BASE}${path}?${qs}`;
    try {
        const { data } = await axios({ method, url, headers: { "X-MBX-APIKEY": key } });
        return data;
    } catch (err) {
        const errorLogger = withContext(logger, { ...context, exchange: "binance", path });
        errorLogger.error({ fn: "privateRequest", method, status: err?.response?.status }, "Binance request failed");
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

export async function getAccountOverview(options = {}) {
    const [assets, spotBalances, marginAccount, marginPositions] = await Promise.all([
        getAccountAssets(),
        getSpotBalances(options.spot),
        getMarginAccount(options.margin),
        getMarginPositionRisk(options.positions)
    ]);

    return {
        assets,
        spotBalances,
        marginAccount,
        marginPositions
    };
}

export async function placeMarketOrder(symbol, side, quantity) {
    const data = await privateRequest("POST", "/api/v3/order", {
        symbol,
        side,
        type: "MARKET",
        quantity
    });
    const price = parseFloat(data?.fills?.[0]?.price);
    logTrade({ id: data.orderId, symbol, side, quantity, entry: price, type: "MARKET" });
    return data;
}

export async function placeLimitOrder(symbol, side, quantity, price) {
    const data = await privateRequest("POST", "/api/v3/order", {
        symbol,
        side,
        type: "LIMIT",
        timeInForce: "GTC",
        quantity,
        price
    });
    logTrade({ id: data.orderId, symbol, side, quantity, entry: price, type: "LIMIT" });
    return data;
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
