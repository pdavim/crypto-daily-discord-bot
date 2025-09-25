// Each asset can optionally provide a `marketCapRank` field so downstream
// modules (like the alert dispatcher) can prioritise higher-cap markets when
// sorting notifications. When omitted the ordering gracefully falls back to an
// alphabetical comparison by `key`.
export const ASSETS = [
    { key: "BTC", binance: process.env.BINANCE_SYMBOL_BTC },
    { key: "ETH", binance: process.env.BINANCE_SYMBOL_ETH },
    { key: "SOL", binance: process.env.BINANCE_SYMBOL_SOL },
    { key: "TRX", binance: process.env.BINANCE_SYMBOL_TRX },
    { key: "POL", binance: process.env.BINANCE_SYMBOL_POL },
    { key: "SUI", binance: process.env.BINANCE_SYMBOL_SUI }
];

export const TIMEFRAMES = ["4h", "1h", "45m", "30m", "15m", "5m"];
// Binance intervals: 45m aggregated from 15m
export const BINANCE_INTERVALS = { "45m": "15m" };
