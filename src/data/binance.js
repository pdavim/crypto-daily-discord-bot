import axios from "axios";
import { LRUCache } from "lru-cache";
import { fetchWithRetry } from "../utils.js";
import { CFG } from "../config.js";
import { logger, withContext, createContext } from "../logger.js";
import { performance } from 'node:perf_hooks';
import { recordPerf } from '../perf.js';

const BASE = "https://api.binance.com/api/v3/klines";
const CANDLES = 200; // solicitamos pelo menos 200 barras
const RATE_LIMIT_MS = 200;
let lastCall = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // ~10 minutes

// Cache for OHLCV and daily close requests
const cache = new LRUCache({ max: 500, ttl: CACHE_TTL_MS });

async function rateLimit() {
    const now = Date.now();
    const wait = Math.max(0, lastCall + RATE_LIMIT_MS - now);
    if (wait > 0) {
        await new Promise(res => setTimeout(res, wait));
    }
    lastCall = Date.now();
}

export async function fetchOHLCV(symbol, interval) {
    const start = performance.now();
    const log = withContext(logger, createContext({ asset: symbol, timeframe: interval }));
    const cacheKey = `ohlcv:${symbol}:${interval}`;
    const cached = cache.get(cacheKey);
    if (cached) {
        const ms = performance.now() - start;
        log.debug({ fn: 'fetchOHLCV', ms }, 'duration');
        recordPerf('fetchOHLCV', ms);
        return cached;
    }
    log.info({ fn: 'fetchOHLCV' }, `Fetching OHLCV for ${symbol} ${interval}`);
    const url = `${BASE}?symbol=${symbol}&interval=${interval}&limit=${CANDLES}`;
    const { data } = await fetchWithRetry(async () => {
        await rateLimit();
        return axios.get(url);
    });
    if (CFG.debug) {
        log.info({ fn: 'fetchOHLCV', data }, "OHLCV data");
    }
    const result = data.map(c => ({
        t: new Date(c[0]),
        o: +c[1], h: +c[2], l: +c[3], c: +c[4],
        v: +c[5]
    }));
    cache.set(cacheKey, result);
    const ms = performance.now() - start;
    log.debug({ fn: 'fetchOHLCV', ms }, 'duration');
    recordPerf('fetchOHLCV', ms);
    return result;
}

export async function fetchDailyCloses(symbol, days = 32) {
    const cacheKey = `daily:${symbol}:${days}`;
    const cached = cache.get(cacheKey);
    if (cached) {
        return cached;
    }
    const log = withContext(logger, createContext({ asset: symbol, timeframe: '1d' }));
    log.info({ fn: 'fetchDailyCloses' }, `Fetching daily closes for ${symbol} last ${days} days`);
    const url = `${BASE}?symbol=${symbol}&interval=1d&limit=${days}`;
    const { data } = await fetchWithRetry(async () => {
        await rateLimit();
        return axios.get(url);
    });
    if (CFG.debug) {
        log.info({ fn: 'fetchDailyCloses', data }, "Daily closes data");
    }
    const result = data.map(c => ({ t: new Date(c[0]), c: +c[4], v: +c[5] }));
    cache.set(cacheKey, result);
    return result;
}
