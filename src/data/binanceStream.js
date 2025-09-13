import WebSocket from 'ws';
import { CFG } from '../config.js';
import { logger, withContext, createContext } from '../logger.js';

const BASE_URL = 'wss://stream.binance.com:9443/stream?streams=';

/**
 * Start a Binance kline WebSocket stream for multiple symbol/interval pairs.
 * @param {Array<{symbol:string, interval:string}>} pairs Array of pairs to subscribe.
 * @param {(symbol:string, interval:string)=>void} onCandleClose Callback when a candle closes.
 * @returns {WebSocket}
 */
export function streamKlines(pairs, onCandleClose) {
    if (!pairs || pairs.length === 0) {
        throw new Error('No pairs provided for streaming');
    }
    const streamNames = pairs
        .map(p => `${p.symbol.toLowerCase()}@kline_${p.interval}`)
        .join('/');
    const ws = new WebSocket(`${BASE_URL}${streamNames}`);

    ws.on('message', msg => {
        try {
            const payload = JSON.parse(msg);
            const data = payload.data || payload;
            const { s: symbol, k } = data;
            if (k && k.x) { // candle closed
                onCandleClose(symbol, k.i);
            }
        } catch (e) {
            if (CFG.debug) {
                withContext(logger, createContext()).error({ fn: 'streamKlines', err: e }, '[BinanceWS] parse error');
            }
        }
    });

    ws.on('error', err => {
        withContext(logger, createContext()).error({ fn: 'streamKlines', err }, '[BinanceWS] error');
    });

    ws.on('close', () => {
        withContext(logger, createContext()).warn({ fn: 'streamKlines' }, '[BinanceWS] connection closed');
    });

    return ws;
}
