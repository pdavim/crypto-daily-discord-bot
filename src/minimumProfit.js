import { CFG } from "./config.js";
import { getSetting, setSetting } from "./settings.js";

const STORAGE_KEY = "minimumProfitThreshold";
const DEFAULT_SETTINGS = { default: 0, users: {} };

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toRatio(value) {
    if (value === undefined || value === null) {
        return null;
    }
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) {
        return null;
    }
    if (parsed < 0 || parsed > 1) {
        return null;
    }
    return parsed;
}

function normalizeSettings(raw, fallback = DEFAULT_SETTINGS) {
    const normalized = {
        default: DEFAULT_SETTINGS.default,
        users: {},
    };

    const fallbackDefault = toRatio(fallback?.default);
    if (fallbackDefault !== null) {
        normalized.default = fallbackDefault;
    }

    const parsedDefault = toRatio(raw?.default);
    if (parsedDefault !== null) {
        normalized.default = parsedDefault;
    }

    const fallbackUsers = isPlainObject(fallback?.users) ? fallback.users : DEFAULT_SETTINGS.users;
    for (const [userId, value] of Object.entries(fallbackUsers)) {
        const parsed = toRatio(value);
        if (parsed !== null) {
            normalized.users[userId] = parsed;
        }
    }

    if (isPlainObject(raw?.users)) {
        for (const [userId, value] of Object.entries(raw.users)) {
            const parsed = toRatio(value);
            if (parsed !== null) {
                normalized.users[userId] = parsed;
            } else if (userId in normalized.users) {
                delete normalized.users[userId];
            }
        }
    }

    return normalized;
}

function cloneSettings(settings) {
    return {
        default: settings.default,
        users: { ...settings.users },
    };
}

function applyToConfig(settings) {
    const normalized = normalizeSettings(settings, CFG.minimumProfitThreshold ?? DEFAULT_SETTINGS);
    CFG.minimumProfitThreshold = cloneSettings(normalized);
    return CFG.minimumProfitThreshold;
}

export function getMinimumProfitSettings() {
    const fallback = isPlainObject(CFG.minimumProfitThreshold) ? CFG.minimumProfitThreshold : DEFAULT_SETTINGS;
    const stored = getSetting(STORAGE_KEY, fallback);
    const normalized = normalizeSettings(stored, fallback);
    applyToConfig(normalized);
    return cloneSettings(normalized);
}

function persistSettings(partialSettings) {
    const current = getMinimumProfitSettings();
    const merged = {
        default: partialSettings.default ?? current.default,
        users: {
            ...current.users,
            ...(isPlainObject(partialSettings.users) ? partialSettings.users : {}),
        },
    };
    const normalized = normalizeSettings(merged, current);
    setSetting(STORAGE_KEY, normalized);
    applyToConfig(normalized);
    return cloneSettings(normalized);
}

export function setDefaultMinimumProfit(ratio) {
    const next = persistSettings({ default: ratio });
    return next;
}

export function setPersonalMinimumProfit(userId, ratio) {
    if (!userId) {
        return getMinimumProfitSettings();
    }
    const next = persistSettings({ users: { [userId]: ratio } });
    return next;
}

export function getMinimumProfitForUser(userId) {
    const settings = getMinimumProfitSettings();
    if (userId && settings.users[userId] !== undefined) {
        return settings.users[userId];
    }
    return settings.default;
}

export function getDefaultMinimumProfitThreshold() {
    return getMinimumProfitSettings().default;
}

export function computeTargetProfit(entry, target, { side = "long" } = {}) {
    const entryValue = Number.parseFloat(entry);
    const targetValue = Number.parseFloat(target);
    if (!Number.isFinite(entryValue) || entryValue <= 0) {
        return null;
    }
    if (!Number.isFinite(targetValue) || targetValue <= 0) {
        return null;
    }
    const direction = side === "short" ? -1 : 1;
    const diff = (targetValue - entryValue) * direction;
    if (diff <= 0) {
        return 0;
    }
    return diff / entryValue;
}

export function meetsMinimumProfitThreshold({ entry, target, side = "long", userId, threshold } = {}) {
    const profitRatio = computeTargetProfit(entry, target, { side });
    if (profitRatio === null) {
        return false;
    }
    const baseThreshold = Number.isFinite(threshold) ? threshold : getMinimumProfitForUser(userId);
    const normalizedThreshold = Number.isFinite(baseThreshold) && baseThreshold >= 0 ? baseThreshold : 0;
    return profitRatio >= normalizedThreshold;
}
