import { CFG, onConfigChange } from "./config.js";

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

/**
 * Basic token bucket implementation that throttles asynchronous tasks.
 */
class TokenBucket {
    /**
     * @param {Object} [limitConfig] - Configuration that defines the token bucket behaviour.
     * @param {number} [limitConfig.capacity] - Maximum number of tokens.
     * @param {number} [limitConfig.refillAmount] - Tokens refilled on each interval.
     * @param {number} [limitConfig.refillIntervalMs] - Interval duration in milliseconds.
     */
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

    /**
     * Reserves a token before executing the next queued task.
     * @returns {Promise} Resolves when the caller is allowed to proceed.
     */
    consume() {
        return new Promise(resolve => {
            this.queue.push(resolve);
            this.drain();
        });
    }

    /**
     * Attempts to release queued tasks while tokens are available.
     * @returns {void}
     */
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

    /**
     * Refills the bucket according to the elapsed time since the last refill.
     * @returns {void}
     */
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

    /**
     * Schedules the next drain attempt when tokens are expected to be available.
     * @returns {void}
     */
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

/**
 * Rate limiter that manages token buckets per Discord webhook or channel.
 */
class DiscordRateLimit {
    /**
     * @param {Object} [config] - Limit configuration.
     * @param {Object} [config.default] - Default rate limit applied to unknown channels.
     * @param {Object<string, Object>} [config.webhooks] - Per-webhook limit overrides.
     */
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

    /**
     * Consumes a token for the requested channel before proceeding.
     * @param {string} [channelId='default'] - Discord channel or webhook identifier.
     * @returns {Promise} Resolves when the caller can continue.
     */
    consume(channelId = 'default') {
        const bucket = this.getBucket(channelId ?? 'default');
        return bucket.consume();
    }

    /**
     * Retrieves or creates the bucket assigned to a channel.
     * @param {string} channelId - Discord channel or webhook identifier.
     * @returns {TokenBucket} Bucket associated with the channel.
     */
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

/**
 * Shared rate limiter instance configured from the current application settings.
 * @type {DiscordRateLimit}
 */
export let limit = new DiscordRateLimit(CFG.discordRateLimit ?? {});
onConfigChange((cfg) => {
    limit = new DiscordRateLimit(cfg.discordRateLimit ?? {});
});
export { DiscordRateLimit };
