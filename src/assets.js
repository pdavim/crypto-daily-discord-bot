export const ASSETS = [
    { key: "BTC", binance: process.env.BINANCE_SYMBOL_BTC },
    { key: "ETH", binance: process.env.BINANCE_SYMBOL_ETH },
    { key: "SOL", binance: process.env.BINANCE_SYMBOL_SOL },
    { key: "TRX", binance: process.env.BINANCE_SYMBOL_TRX },
    { key: "POL", binance: process.env.BINANCE_SYMBOL_POL },
    { key: "SUI", binance: process.env.BINANCE_SYMBOL_SUI }
];

export const TIMEFRAMES = ["4h", "1h", "45m", "30m", "15m", "5m"];
// Mapa para Binance (klines): 4h->4h, 1h->1h, 45m->45m, 30m->30m, 15m->15m, 5m->5m
