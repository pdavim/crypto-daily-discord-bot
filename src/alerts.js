import { performance } from "node:perf_hooks";
import { logger, withContext } from "./logger.js";
import { recordPerf } from "./perf.js";
import { CFG } from "./config.js";
import { DEFAULT_ALERT_MODULES } from "./alerts/registry.js";
import { ALERT_LEVELS, ALERT_CATEGORIES, ALERT_CATEGORY_LABELS } from "./alerts/shared.js";

const LEVEL_ORDER = {
    [ALERT_LEVELS.HIGH]: 0,
    [ALERT_LEVELS.MEDIUM]: 1,
    [ALERT_LEVELS.LOW]: 2
};

const LEVEL_STYLES = {
    [ALERT_LEVELS.HIGH]: { emoji: '🔴', label: 'ALTA' },
    [ALERT_LEVELS.MEDIUM]: { emoji: '🟠', label: 'MÉDIA' },
    [ALERT_LEVELS.LOW]: { emoji: '🟢', label: 'BAIXA' }
};

const moduleCache = new Map();

function resolveModules() {
    const modulesConfig = CFG.alerts?.modules;
    if (!modulesConfig) {
        return [...DEFAULT_ALERT_MODULES];
    }

    const enabledDefaults = DEFAULT_ALERT_MODULES.filter(name => modulesConfig[name] !== false);
    const additional = Object.entries(modulesConfig)
        .filter(([name, enabled]) => enabled && !DEFAULT_ALERT_MODULES.includes(name))
        .map(([name]) => name);

    return [...enabledDefaults, ...additional];
}

async function loadModule(name) {
    if (!moduleCache.has(name)) {
        const promise = import(`./alerts/${name}.js`).catch(error => {
            moduleCache.delete(name);
            throw error;
        });
        moduleCache.set(name, promise);
    }
    return moduleCache.get(name);
}

function normalizeAlerts(result) {
    if (!result) {
        return [];
    }
    const items = Array.isArray(result) ? result : [result];
    return items
        .filter(Boolean)
        .map(alert => {
            if (alert && typeof alert === 'object' && 'msg' in alert && 'level' in alert) {
                return {
                    ...alert,
                    category: alert.category ?? ALERT_CATEGORIES.INFO
                };
            }
            if (typeof alert === 'string') {
                return { msg: alert, level: ALERT_LEVELS.MEDIUM, category: ALERT_CATEGORIES.INFO };
            }
            return null;
        })
        .filter(Boolean);
}

/**
 * Executes all registered alert modules and returns normalized alert objects.
 * @param {object} context - Technical indicators and metadata for alert generation.
 * @returns {Promise} Generated alerts ordered by severity.
 */
export async function buildAlerts(context) {
    const start = performance.now();
    const alerts = [];
    const thresholds = CFG.alertThresholds;
    const modules = resolveModules();
    const log = withContext(logger);

    const sharedContext = { ...context, thresholds };

    for (const moduleName of modules) {
        try {
            const module = await loadModule(moduleName);
            const fn = module?.default;
            if (typeof fn !== 'function') {
                log.warn({ fn: 'buildAlerts', moduleName }, 'alert module has no default function');
                continue;
            }
            const result = await fn(sharedContext);
            alerts.push(...normalizeAlerts(result));
        } catch (error) {
            log.error({ fn: 'buildAlerts', moduleName, err: error }, 'failed to execute alert module');
        }
    }

    const ms = performance.now() - start;
    log.debug({ fn: 'buildAlerts', ms }, 'duration');
    recordPerf('buildAlerts', ms);
    alerts.sort((a, b) => {
        const aOrder = LEVEL_ORDER[a.level] ?? LEVEL_ORDER[ALERT_LEVELS.MEDIUM];
        const bOrder = LEVEL_ORDER[b.level] ?? LEVEL_ORDER[ALERT_LEVELS.MEDIUM];
        return aOrder - bOrder;
    });

    return alerts;
}

/**
 * Formats an alert for presentation on Discord.
 * @param {Object} alert - Alert details.
 * @param {string} alert.msg - Message text.
 * @param {string} alert.level - Severity level identifier.
 * @param {string} [alert.category] - Optional alert category.
 * @param {number} [count=1] - Number of times the alert was triggered.
 * @returns {string} Human-readable alert message.
 */
export function formatAlertMessage({ msg, level, category }, count = 1) {
    const { emoji, label } = LEVEL_STYLES[level] ?? LEVEL_STYLES[ALERT_LEVELS.MEDIUM];
    const categoryLabel = category ? ALERT_CATEGORY_LABELS[category] : null;
    const segments = [`${emoji} **${label}:**`];
    if (categoryLabel) {
        segments.push(`_${categoryLabel}_ —`);
    }
    segments.push(msg);
    const suffix = count > 1 ? ` x${count}` : '';
    return `${segments.join(' ')}${suffix}`;
}

export { ALERT_LEVELS };
