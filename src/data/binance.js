import axios from "axios";
import { fetchWithRetry } from "../utils.js";
import { CFG } from "../config.js";

const BASE = "https://api.binance.com/api/v3/klines";
const CANDLES = 200; // solicitamos pelo menos 200 barras
const RATE_LIMIT_MS = 200;
let lastCall = 0;

async function rateLimit() {
    const now = Date.now();
    const wait = Math.max(0, lastCall + RATE_LIMIT_MS - now);
    if (wait > 0) {
        await new Promise(res => setTimeout(res, wait));
    }
    lastCall = Date.now();
}

export async function fetchOHLCV(symbol, interval) {
    console.log(`Fetching OHLCV for ${symbol} ${interval}`);
    const url = `${BASE}?symbol=${symbol}&interval=${interval}&limit=${CANDLES}`;
    const { data } = await fetchWithRetry(async () => {
        await rateLimit();
        return axios.get(url);
    });
    if (CFG.debug) {
        console.log("OHLCV data:", data);
    }
    return data.map(c => ({
        t: new Date(c[0]),
        o: +c[1], h: +c[2], l: +c[3], c: +c[4],
        v: +c[5]
    }));
}

export async function fetchDailyCloses(symbol, days = 32) {
    console.log(`Fetching daily closes for ${symbol} last ${days} days`);
    const url = `${BASE}?symbol=${symbol}&interval=1d&limit=${days}`;
    const { data } = await fetchWithRetry(async () => {
        await rateLimit();
        return axios.get(url);
    });
    if (CFG.debug) {
        console.log("Daily closes data:", data);
    }
    return data.map(c => ({ t: new Date(c[0]), c: +c[4], v: +c[5] }));
}
