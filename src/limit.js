import os from "os";
import { CFG } from "./config.js";

/**
 * Determines the maximum number of concurrent tasks the bot should run.
 * @returns {number} Recommended concurrency level.
 */
export function calcConcurrency() {
    const max = Number(CFG.maxConcurrency);
    if (Number.isInteger(max) && max > 0) {
        return max;
    }

    try {
        const cpus = os.cpus();
        if (Array.isArray(cpus) && cpus.length > 0) {
            return cpus.length;
        }
    } catch (_) {
        // Fall through to default below when os.cpus() is unavailable.
    }

    return 1;
}

/**
 * Creates a limiter that runs asynchronous functions with restricted concurrency.
 * @param {number} concurrency - Maximum number of simultaneous executions.
 * @returns {Function} Wrapper enforcing the limit.
 */
export default function pLimit(concurrency) {
    if (concurrency < 1) {
        throw new TypeError('Expected `concurrency` to be a number greater than 0');
    }
    const queue = [];
    let activeCount = 0;
    const next = () => {
        activeCount--;
        if (queue.length > 0) {
            const { fn, resolve, reject } = queue.shift();
            run(fn).then(resolve).catch(reject);
        }
    };
    const run = async fn => {
        activeCount++;
        try {
            return await fn();
        } finally {
            next();
        }
    };
    return fn =>
        activeCount < concurrency
            ? run(fn)
            : new Promise((resolve, reject) => queue.push({ fn, resolve, reject }));
}
