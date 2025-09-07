import axios from "axios";

const BASE = "https://api.binance.com/api/v3/klines";
const CANDLES = 300;

export async function fetchOHLCV(symbol, interval) {
    const url = `${BASE}?symbol=${symbol}&interval=${interval}&limit=${CANDLES}`;
    const { data } = await axios.get(url);
    return data.map(c => ({
        t: new Date(c[0]),
        o: +c[1], h: +c[2], l: +c[3], c: +c[4],
        v: +c[5]
    }));
}

export async function fetchDailyCloses(symbol, days = 32) {
    const url = `${BASE}?symbol=${symbol}&interval=1d&limit=${days}`;
    const { data } = await axios.get(url);
    return data.map(c => ({ t: new Date(c[0]), c: +c[4], v: +c[5] }));
}
