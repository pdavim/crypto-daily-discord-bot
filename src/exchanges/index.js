import { getAssetConfig } from "../config.js";
import { binanceConnector } from "./binanceConnector.js";

const registry = new Map();

function assertValidConnector(connector) {
    if (!connector || typeof connector !== "object") {
        throw new TypeError("Connector must be an object");
    }
    const { id } = connector;
    if (typeof id !== "string" || id.trim() === "") {
        throw new TypeError("Connector.id must be a non-empty string");
    }
    if (typeof connector.fetchCandles !== "function") {
        throw new TypeError(`Connector ${id} is missing fetchCandles()`);
    }
    if (typeof connector.fetchDailyCloses !== "function") {
        throw new TypeError(`Connector ${id} is missing fetchDailyCloses()`);
    }
    if (typeof connector.placeOrder !== "function") {
        throw new TypeError(`Connector ${id} is missing placeOrder()`);
    }
    if (typeof connector.getBalances !== "function") {
        throw new TypeError(`Connector ${id} is missing getBalances()`);
    }
}

export function registerExchangeConnector(connector, { replace = false } = {}) {
    assertValidConnector(connector);
    const id = connector.id;
    if (!replace && registry.has(id)) {
        throw new Error(`Connector ${id} already registered`);
    }
    registry.set(id, connector);
    return connector;
}

export function unregisterExchangeConnector(id) {
    registry.delete(id);
}

export function getExchangeConnector(id) {
    return registry.get(id) ?? null;
}

export function listExchangeConnectors() {
    return Array.from(registry.values());
}

export function resolveConnectorForAsset(assetOrKey) {
    if (!assetOrKey) {
        return null;
    }
    const asset = typeof assetOrKey === "string"
        ? getAssetConfig(assetOrKey)
        : assetOrKey;
    if (!asset || typeof asset.exchange !== "string") {
        return null;
    }
    return getExchangeConnector(asset.exchange);
}

registerExchangeConnector(binanceConnector);

export const __private__ = { registry };
