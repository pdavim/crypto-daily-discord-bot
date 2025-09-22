import { performance } from 'node:perf_hooks';
import { logger, withContext } from './logger.js';
import { recordPerf } from './perf.js';
import { CFG } from './config.js';
import { DEFAULT_ALERT_MODULES } from './alerts/registry.js';

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
    if (Array.isArray(result)) {
        return result.filter(Boolean);
    }
    return [result].filter(Boolean);
}

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
    return alerts;
}
