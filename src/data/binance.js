import axios from "axios";
import { fetchWithRetry } from "../utils.js";
import { CFG } from "../config.js";

const BASE = "https://api.binance.com/api/v3/klines";
const CANDLES = 200; // solicitamos pelo menos 200 barras

export async function fetchOHLCV(symbol, interval) {
    console.log(`Fetching OHLCV for ${symbol} ${interval}`);
    const url = `${BASE}?symbol=${symbol}&interval=${interval}&limit=${CANDLES}`;
    const { data } = await fetchWithRetry(() => axios.get(url));
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
    const { data } = await fetchWithRetry(() => axios.get(url));
    if (CFG.debug) {
        console.log("Daily closes data:", data);
    }
    return data.map(c => ({ t: new Date(c[0]), c: +c[4], v: +c[5] }));
}
