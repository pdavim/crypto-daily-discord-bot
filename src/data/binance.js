import axios from "axios";

const BASE = "https://api.binance.com/api/v3/klines";
// timeframe -> número de candles para cobrir indicadores de 20 períodos
const CANDLES = 300;

export async function fetchOHLCV(symbol, interval) {
    const url = `${BASE}?symbol=${symbol}&interval=${interval}&limit=${CANDLES}`;
    const { data } = await axios.get(url);
    // [ openTime, open, high, low, close, volume, ...]
    return data.map(c => ({
        t: new Date(c[0]),
        o: +c[1], h: +c[2], l: +c[3], c: +c[4],
        v: +c[5]
    }));
}
