export const ASSETS = [
    { key: "BTC", tv: process.env.TV_SYMBOL_BTC, binance: process.env.BINANCE_SYMBOL_BTC },
    { key: "ETH", tv: process.env.TV_SYMBOL_ETH, binance: process.env.BINANCE_SYMBOL_ETH },
    { key: "SOL", tv: process.env.TV_SYMBOL_SOL, binance: process.env.BINANCE_SYMBOL_SOL },
    { key: "TRX", tv: process.env.TV_SYMBOL_TRX, binance: process.env.BINANCE_SYMBOL_TRX },
    { key: "POL", tv: process.env.TV_SYMBOL_POL, binance: process.env.BINANCE_SYMBOL_POL },
    { key: "SUI", tv: process.env.TV_SYMBOL_SUI, binance: process.env.BINANCE_SYMBOL_SUI }
];

export const TIMEFRAMES = ["4h", "1h", "45m", "30m", "15m", "5m"];
// Mapa para Binance (klines): 4h->4h, 1h->1h, 45m->45m, 30m->30m, 15m->15m, 5m->5m
