import fs from "fs";
import path from "path";

const DATA_DIR = path.resolve(process.cwd(), 'data');
const SETTINGS_FILE = process.env.SETTINGS_FILE
    ? path.resolve(process.env.SETTINGS_FILE)
    : path.join(DATA_DIR, 'settings.json');

let settings = {};
let loaded = false;

function mergeDefaults(defaults) {
    if (!defaults || typeof defaults !== 'object') {
        return;
    }
    settings = { ...defaults, ...settings };
}

function persist() {
    const dir = path.dirname(SETTINGS_FILE);
    fs.mkdirSync(dir, { recursive: true });
    const keys = Object.keys(settings);
    if (keys.length === 0) {
        if (fs.existsSync(SETTINGS_FILE)) {
            fs.rmSync(SETTINGS_FILE);
        }
        return;
    }
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

/**
 * Loads persisted settings merging them with the provided defaults.
 * @param {Object} [defaults={}] - Default values for missing settings.
 * @returns {Object} Mutable settings object.
 */
export function loadSettings(defaults = {}) {
    if (!loaded) {
        settings = {};
        try {
            if (fs.existsSync(SETTINGS_FILE)) {
                const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
                const parsed = JSON.parse(raw || '{}');
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    settings = { ...parsed };
                }
            } else {
                fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
            }
        } catch (err) {
            settings = {};
        }
        loaded = true;
    }
    mergeDefaults(defaults);
    return settings;
}

/**
 * Returns the in-memory settings object, loading it if necessary.
 * @returns {Object} Current settings.
 */
export function getSettings() {
    if (!loaded) {
        loadSettings();
    }
    return settings;
}

/**
 * Retrieves a single setting value with an optional fallback.
 * @param {string} key - Setting key.
 * @param {*} [fallback] - Value returned when the setting is undefined.
 * @returns {*} Stored value or the fallback.
 */
export function getSetting(key, fallback) {
    if (!loaded) {
        loadSettings();
    }
    return key in settings ? settings[key] : fallback;
}

/**
 * Updates or removes a setting and persists the change.
 * @param {string} key - Setting key.
 * @param {*} value - New value; when undefined the key is removed.
 * @returns {*} Stored value after the update.
 */
export function setSetting(key, value) {
    if (!loaded) {
        loadSettings();
    }
    if (value === undefined) {
        delete settings[key];
    } else {
        settings[key] = value;
    }
    persist();
    return settings[key];
}

/**
 * Clears all stored settings and removes the persisted file.
 * @returns {void}
 */
export function resetSettings() {
    settings = {};
    loaded = true;
    if (fs.existsSync(SETTINGS_FILE)) {
        fs.rmSync(SETTINGS_FILE);
    }
}
