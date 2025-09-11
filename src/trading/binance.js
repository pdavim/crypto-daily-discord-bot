import axios from "axios";
import crypto from "crypto";
import WebSocket from "ws";
import { logTrade } from "./tradeLog.js";
import { logger } from "../logger.js";

const BASE = "https://api.binance.com";
const WS_BASE = "wss://stream.binance.com:9443/ws";
const API_KEY = process.env.BINANCE_API_KEY;
const API_SECRET = process.env.BINANCE_SECRET;

function sign(params) {
    const query = new URLSearchParams(params).toString();
    const signature = crypto.createHmac("sha256", API_SECRET).update(query).digest("hex");
    return `${query}&signature=${signature}`;
}

async function privateRequest(method, path, params = {}) {
    if (!API_KEY || !API_SECRET) {
        throw new Error("Missing Binance API credentials");
    }
    const timestamp = Date.now();
    const qs = sign({ ...params, timestamp });
    const url = `${BASE}${path}?${qs}`;
    const { data } = await axios({ method, url, headers: { "X-MBX-APIKEY": API_KEY } });
    return data;
}

export async function getBalances() {
    const data = await privateRequest("GET", "/api/v3/account");
    return data.balances;
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
            logger.error({ asset: symbol, timeframe: undefined, fn: 'subscribeTicker', err: e }, "WS parse error");
        }
    });
    return ws;
}
