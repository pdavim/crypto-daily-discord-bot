import { CFG } from './config.js';

const DEFAULT_LIMIT = {
    capacity: 5,
    refillAmount: 1,
    refillIntervalMs: 1000,
};

const normalizeNumber = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizeLimit = (limit = {}) => ({
    capacity: normalizeNumber(limit.capacity, DEFAULT_LIMIT.capacity),
    refillAmount: normalizeNumber(limit.refillAmount ?? limit.tokensPerInterval, DEFAULT_LIMIT.refillAmount),
    refillIntervalMs: normalizeNumber(limit.refillIntervalMs ?? limit.intervalMs, DEFAULT_LIMIT.refillIntervalMs),
});

class TokenBucket {
    constructor(limitConfig = DEFAULT_LIMIT) {
        const normalized = normalizeLimit(limitConfig);
        this.capacity = normalized.capacity;
        this.refillAmount = normalized.refillAmount;
        this.refillIntervalMs = normalized.refillIntervalMs;
        this.tokens = this.capacity;
        this.lastRefill = Date.now();
        this.queue = [];
        this.timer = null;
    }

    consume() {
        return new Promise(resolve => {
            this.queue.push(resolve);
            this.drain();
        });
    }

    drain() {
        this.refill();

        while (this.tokens > 0 && this.queue.length > 0) {
            this.tokens--;
            const resolve = this.queue.shift();
            resolve();
        }

        if (this.queue.length > 0) {
            this.schedule();
        } else if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    refill() {
        const now = Date.now();
        if (now <= this.lastRefill) {
            return;
        }

        const elapsed = now - this.lastRefill;
        const intervals = Math.floor(elapsed / this.refillIntervalMs);
        if (intervals <= 0) {
            return;
        }

        this.tokens = Math.min(this.capacity, this.tokens + intervals * this.refillAmount);
        this.lastRefill += intervals * this.refillIntervalMs;
    }

    schedule() {
        if (this.timer) {
            return;
        }

        const now = Date.now();
        const elapsed = now - this.lastRefill;
        const remaining = this.refillIntervalMs - elapsed;
        const delay = remaining > 0 ? remaining : this.refillIntervalMs;

        this.timer = setTimeout(() => {
            this.timer = null;
            this.drain();
        }, delay);
    }
}

class DiscordRateLimit {
    constructor(config = {}) {
        const { default: defaultLimit, webhooks } = config;
        this.defaultLimit = normalizeLimit(defaultLimit);
        this.webhookLimits = new Map();
        if (webhooks && typeof webhooks === 'object') {
            for (const [key, value] of Object.entries(webhooks)) {
                this.webhookLimits.set(key, normalizeLimit(value));
            }
        }
        this.buckets = new Map();
    }

    consume(channelId = 'default') {
        const bucket = this.getBucket(channelId ?? 'default');
        return bucket.consume();
    }

    getBucket(channelId) {
        const key = channelId ?? 'default';
        let bucket = this.buckets.get(key);
        if (!bucket) {
            const limit = this.webhookLimits.get(key) ?? this.defaultLimit;
            bucket = new TokenBucket(limit);
            this.buckets.set(key, bucket);
        }
        return bucket;
    }
}

export const limit = new DiscordRateLimit(CFG.discordRateLimit ?? {});
export { DiscordRateLimit };
