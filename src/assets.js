function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function resolveEnvSymbol(exchange, assetKey, env = process.env) {
    if (!exchange || !assetKey) {
        return null;
    }
    const upperKey = assetKey.toUpperCase();
    if (exchange === "binance") {
        const legacyKey = `BINANCE_SYMBOL_${upperKey}`;
        const legacyValue = env[legacyKey];
        if (typeof legacyValue === "string") {
            const trimmed = legacyValue.trim();
            if (trimmed !== "") {
                return trimmed;
            }
        }
    }
    const genericKey = `${exchange.toUpperCase()}_SYMBOL_${upperKey}`;
    const genericValue = env[genericKey];
    if (typeof genericValue === "string") {
        const trimmed = genericValue.trim();
        if (trimmed !== "") {
            return trimmed;
        }
    }
    return null;
}

function normalizeMetadata(metadata) {
    if (!isPlainObject(metadata)) {
        return {};
    }
    return { ...metadata };
}

const DEFAULT_CAPABILITIES = Object.freeze({
    candles: true,
    daily: true,
    streaming: false,
    trading: false,
    margin: false,
    forecasting: true,
});

function normalizeCapabilities(capabilities) {
    const base = isPlainObject(capabilities) ? capabilities : {};
    return {
        candles: base.candles !== false,
        daily: base.daily !== false,
        streaming: base.streaming === true,
        trading: base.trading === true,
        margin: base.margin === true,
        forecasting: base.forecasting !== false,
    };
}

function normalizeSymbols(symbols, fallback) {
    const base = isPlainObject(symbols) ? symbols : {};
    const normalized = {};
    for (const [key, value] of Object.entries(base)) {
        if (typeof value === "string") {
            const trimmed = value.trim();
            if (trimmed !== "") {
                normalized[key] = trimmed;
            }
        }
    }
    if (fallback && typeof fallback === "string" && fallback.trim() !== "") {
        if (!normalized.market) {
            normalized.market = fallback;
        }
        if (!normalized.spot) {
            normalized.spot = fallback;
        }
    }
    return normalized;
}

export function normalizeAssetDefinition(definition, { env = process.env } = {}) {
    if (!isPlainObject(definition)) {
        return null;
    }
    const rawKey = typeof definition.key === "string" ? definition.key.trim() : "";
    if (rawKey === "") {
        return null;
    }
    const key = rawKey.toUpperCase();
    const rawExchange = typeof definition.exchange === "string" ? definition.exchange.trim() : "";
    if (rawExchange === "") {
        return null;
    }
    const exchange = rawExchange.toLowerCase();
    const metadata = normalizeMetadata(definition.metadata);
    const baseSymbol = typeof definition.symbol === "string"
        ? definition.symbol.trim()
        : typeof definition.symbols?.market === "string"
            ? definition.symbols.market.trim()
            : typeof definition.symbols?.spot === "string"
                ? definition.symbols.spot.trim()
                : "";
    const envOverride = resolveEnvSymbol(exchange, key, env);
    const resolvedSymbol = envOverride ?? (baseSymbol !== "" ? baseSymbol : null);
    if (!resolvedSymbol) {
        return null;
    }
    const capabilities = normalizeCapabilities(definition.capabilities);
    const symbols = normalizeSymbols(definition.symbols, resolvedSymbol);
    const marketCapRank = Number.isFinite(definition.marketCapRank)
        ? Number(definition.marketCapRank)
        : null;
    const asset = {
        key,
        exchange,
        symbol: resolvedSymbol,
        symbols,
        metadata,
        capabilities,
    };
    if (marketCapRank !== null) {
        asset.marketCapRank = marketCapRank;
    }
    if (typeof definition.description === "string" && definition.description.trim() !== "") {
        asset.description = definition.description.trim();
    }
    return asset;
}

export function buildAssetsConfig(rawAssets, { env = process.env, defaults = [] } = {}) {
    const source = Array.isArray(rawAssets) && rawAssets.length > 0 ? rawAssets : defaults;
    const normalized = [];
    const seen = new Set();
    for (const entry of source) {
        const asset = normalizeAssetDefinition(entry, { env });
        if (!asset) {
            continue;
        }
        if (seen.has(asset.key)) {
            const idx = normalized.findIndex(a => a.key === asset.key);
            if (idx >= 0) {
                normalized[idx] = asset;
            }
            continue;
        }
        normalized.push(asset);
        seen.add(asset.key);
    }
    return normalized;
}

const DEFAULT_BINANCE_SYMBOLS = {
    BTC: resolveEnvSymbol("binance", "BTC") ?? "BTCUSDT",
    ETH: resolveEnvSymbol("binance", "ETH") ?? "ETHUSDT",
    SOL: resolveEnvSymbol("binance", "SOL") ?? "SOLUSDT",
    TRX: resolveEnvSymbol("binance", "TRX") ?? "TRXUSDT",
    POL: resolveEnvSymbol("binance", "POL") ?? "POLUSDT",
    SUI: resolveEnvSymbol("binance", "SUI") ?? "SUIUSDT",
};

export const DEFAULT_ASSETS = [
    {
        key: "BTC",
        exchange: "binance",
        symbol: DEFAULT_BINANCE_SYMBOLS.BTC,
        symbols: {
            spot: DEFAULT_BINANCE_SYMBOLS.BTC,
            margin: DEFAULT_BINANCE_SYMBOLS.BTC,
            stream: DEFAULT_BINANCE_SYMBOLS.BTC,
        },
        metadata: {
            baseAsset: "BTC",
            quoteAsset: "USDT",
        },
        capabilities: {
            ...DEFAULT_CAPABILITIES,
            trading: true,
            margin: true,
            streaming: true,
        },
        marketCapRank: 1,
    },
    {
        key: "ETH",
        exchange: "binance",
        symbol: DEFAULT_BINANCE_SYMBOLS.ETH,
        symbols: {
            spot: DEFAULT_BINANCE_SYMBOLS.ETH,
            margin: DEFAULT_BINANCE_SYMBOLS.ETH,
            stream: DEFAULT_BINANCE_SYMBOLS.ETH,
        },
        metadata: {
            baseAsset: "ETH",
            quoteAsset: "USDT",
        },
        capabilities: {
            ...DEFAULT_CAPABILITIES,
            trading: true,
            margin: true,
            streaming: true,
        },
        marketCapRank: 2,
    },
    {
        key: "SOL",
        exchange: "binance",
        symbol: DEFAULT_BINANCE_SYMBOLS.SOL,
        symbols: {
            spot: DEFAULT_BINANCE_SYMBOLS.SOL,
            stream: DEFAULT_BINANCE_SYMBOLS.SOL,
        },
        metadata: {
            baseAsset: "SOL",
            quoteAsset: "USDT",
        },
        capabilities: {
            ...DEFAULT_CAPABILITIES,
            trading: true,
            streaming: true,
        },
        marketCapRank: 5,
    },
    {
        key: "TRX",
        exchange: "binance",
        symbol: DEFAULT_BINANCE_SYMBOLS.TRX,
        symbols: {
            spot: DEFAULT_BINANCE_SYMBOLS.TRX,
            stream: DEFAULT_BINANCE_SYMBOLS.TRX,
        },
        metadata: {
            baseAsset: "TRX",
            quoteAsset: "USDT",
        },
        capabilities: {
            ...DEFAULT_CAPABILITIES,
            trading: true,
            streaming: true,
        },
        marketCapRank: 13,
    },
    {
        key: "POL",
        exchange: "binance",
        symbol: DEFAULT_BINANCE_SYMBOLS.POL,
        symbols: {
            spot: DEFAULT_BINANCE_SYMBOLS.POL,
            stream: DEFAULT_BINANCE_SYMBOLS.POL,
        },
        metadata: {
            baseAsset: "POL",
            quoteAsset: "USDT",
        },
        capabilities: {
            ...DEFAULT_CAPABILITIES,
            trading: true,
            streaming: true,
        },
        marketCapRank: 17,
    },
    {
        key: "SUI",
        exchange: "binance",
        symbol: DEFAULT_BINANCE_SYMBOLS.SUI,
        symbols: {
            spot: DEFAULT_BINANCE_SYMBOLS.SUI,
            stream: DEFAULT_BINANCE_SYMBOLS.SUI,
        },
        metadata: {
            baseAsset: "SUI",
            quoteAsset: "USDT",
        },
        capabilities: {
            ...DEFAULT_CAPABILITIES,
            trading: true,
            streaming: true,
        },
        marketCapRank: 58,
    },
];

export const TIMEFRAMES = ["4h", "1h", "45m", "30m", "15m", "5m"];

export const EXCHANGE_INTERVAL_OVERRIDES = {
    binance: { "45m": "15m" },
};
