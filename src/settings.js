import fs from 'fs';
import path from 'path';

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

export function getSettings() {
    if (!loaded) {
        loadSettings();
    }
    return settings;
}

export function getSetting(key, fallback) {
    if (!loaded) {
        loadSettings();
    }
    return key in settings ? settings[key] : fallback;
}

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

export function resetSettings() {
    settings = {};
    loaded = true;
    if (fs.existsSync(SETTINGS_FILE)) {
        fs.rmSync(SETTINGS_FILE);
    }
}
