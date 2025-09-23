import WebSocket from 'ws';
import { CFG } from '../config.js';
import { logger, withContext } from '../logger.js';

const BASE_URL = 'wss://stream.binance.com:9443/stream?streams=';

/**
 * Start a Binance kline WebSocket stream for multiple symbol/interval pairs.
 * @param {Array<Object>} pairs Array of pairs to subscribe.
 * @param {Function} onCandleClose Callback when a candle closes.
 * @returns {WebSocket} Connected WebSocket instance.
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
                withContext(logger).error({ fn: 'streamKlines', err: e }, '[BinanceWS] parse error');
            }
        }
    });

    ws.on('error', err => {
        withContext(logger).error({ fn: 'streamKlines', err }, '[BinanceWS] error');
    });

    ws.on('close', () => {
        withContext(logger).warn({ fn: 'streamKlines' }, '[BinanceWS] connection closed');
    });

    return ws;
}
