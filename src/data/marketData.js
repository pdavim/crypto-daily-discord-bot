import { getAssetConfig } from "../config.js";
import { resolveConnectorForAsset } from "../exchanges/index.js";

function normalizeAsset(assetOrKey) {
    if (!assetOrKey) {
        return null;
    }
    if (typeof assetOrKey === "string") {
        return getAssetConfig(assetOrKey);
    }
    if (typeof assetOrKey === "object" && typeof assetOrKey.key === "string") {
        return assetOrKey;
    }
    return null;
}

function resolveSymbol(asset, purpose) {
    if (!asset) {
        return null;
    }
    if (typeof purpose === "string") {
        const fromMap = asset.symbols?.[purpose];
        if (typeof fromMap === "string" && fromMap.trim() !== "") {
            return fromMap.trim();
        }
    }
    if (typeof asset.symbol === "string" && asset.symbol.trim() !== "") {
        return asset.symbol.trim();
    }
    const market = asset.symbols?.market;
    if (typeof market === "string" && market.trim() !== "") {
        return market.trim();
    }
    return null;
}

function ensureConnector(asset) {
    if (!asset) {
        throw new Error("Unknown asset");
    }
    const connector = resolveConnectorForAsset(asset);
    if (!connector) {
        throw new Error(`No connector registered for exchange ${asset.exchange}`);
    }
    return connector;
}

export async function fetchOHLCV(assetOrKey, interval, { limit, purpose = "market" } = {}) {
    const asset = normalizeAsset(assetOrKey);
    if (!asset) {
        throw new Error("Invalid asset provided to fetchOHLCV");
    }
    const connector = ensureConnector(asset);
    const symbol = resolveSymbol(asset, purpose);
    if (!symbol) {
        throw new Error(`Missing symbol for asset ${asset.key}`);
    }
    return connector.fetchCandles({ symbol, interval, limit });
}

export async function fetchDailyCloses(assetOrKey, days = 32, { purpose = "market" } = {}) {
    const asset = normalizeAsset(assetOrKey);
    if (!asset) {
        throw new Error("Invalid asset provided to fetchDailyCloses");
    }
    const connector = ensureConnector(asset);
    const symbol = resolveSymbol(asset, purpose);
    if (!symbol) {
        throw new Error(`Missing symbol for asset ${asset.key}`);
    }
    return connector.fetchDailyCloses({ symbol, days });
}
