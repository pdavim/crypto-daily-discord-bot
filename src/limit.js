import os from 'os';
import { CFG } from './config.js';

export function calcConcurrency() {
    const max = Number(CFG.maxConcurrency);
    return Number.isInteger(max) && max > 0 ? max : os.cpus().length;
}

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
