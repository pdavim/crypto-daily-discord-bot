import * as tf from "@tensorflow/tfjs";

const POSITIVE_WORDS = new Set([
    "gain", "gains", "bull", "bullish", "surge", "rally", "rise", "rises", "soar", "soars",
    "positive", "optimistic", "growth", "breakout", "record", "all-time", "support", "rebound",
    "recover", "recovery", "strong", "upgrade", "beat", "beats", "improve", "improves",
    "profit", "profits", "expands", "expansion", "opportunity", "momentum", "stability",
]);

const NEGATIVE_WORDS = new Set([
    "loss", "losses", "bear", "bearish", "drop", "drops", "plunge", "plunges", "crash",
    "crashes", "decline", "declines", "negative", "fear", "panic", "selloff", "sell-off",
    "recession", "lawsuit", "fraud", "ban", "downturn", "weak", "downgrade", "fail", "fails",
    "collapse", "collapses", "halt", "risk", "risks", "volatility",
]);

const INTENSIFIERS = new Map([
    ["very", 0.6],
    ["highly", 0.8],
    ["extremely", 0.9],
    ["massive", 0.7],
    ["huge", 0.6],
    ["major", 0.5],
    ["slight", -0.3],
    ["minor", -0.3],
]);

const NEGATIONS = new Set([
    "no", "not", "never", "without", "hardly", "barely", "scarcely",
]);

const WORD_REGEX = /[a-zA-Z][a-zA-Z\-']+/g;

function tokenize(text) {
    if (typeof text !== "string" || !text) {
        return [];
    }
    const normalized = text
        .replace(/https?:\/\/\S+/g, " ")
        .replace(/[^\w\s!'-]/g, " ")
        .toLowerCase();
    const matches = normalized.match(WORD_REGEX);
    return matches ? matches : [];
}

function extractFeatures(text) {
    const tokens = tokenize(text);
    if (!tokens.length) {
        return { pos: 0, neg: 0, emphasis: 0, length: 0 };
    }

    let pos = 0;
    let neg = 0;
    let emphasis = 0;
    let negate = false;

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const prev = tokens[i - 1];

        if (NEGATIONS.has(token)) {
            negate = !negate;
            continue;
        }

        let weight = 1;
        if (prev && INTENSIFIERS.has(prev)) {
            weight += INTENSIFIERS.get(prev);
        }

        if (POSITIVE_WORDS.has(token)) {
            const contribution = negate ? -weight : weight;
            if (contribution > 0) {
                pos += contribution;
            } else {
                neg += Math.abs(contribution);
            }
            negate = false;
        } else if (NEGATIVE_WORDS.has(token)) {
            const contribution = negate ? weight : weight;
            if (negate) {
                pos += contribution;
            } else {
                neg += contribution;
            }
            negate = false;
        } else if (INTENSIFIERS.has(token)) {
            emphasis += Math.abs(INTENSIFIERS.get(token));
        }
    }

    const exclamations = (text.match(/!/g) || []).length;
    const uppercaseEmphasis = /[A-Z]{3,}/.test(text) ? 0.5 : 0;
    emphasis += exclamations * 0.4 + uppercaseEmphasis;

    const length = tokens.length;
    return { pos, neg, emphasis, length };
}

function buildFeatureTensor({ pos, neg, emphasis, length }) {
    const total = length > 0 ? length : 1;
    const posRatio = pos / total;
    const negRatio = neg / total;
    const net = (pos - neg) / total;
    const emphasisNorm = Math.min(1, emphasis / 5);

    return tf.tensor2d([[posRatio, negRatio, net, emphasisNorm]]);
}

const WEIGHTS = tf.tensor2d([[1.2], [-1.2], [1.8], [0.9]]);
const BIAS = tf.scalar(0);

function scoreFromFeatures(features) {
    return tf.tidy(() => {
        const tensor = buildFeatureTensor(features);
        const linear = tensor.matMul(WEIGHTS).add(BIAS);
        const activated = tf.tanh(linear);
        const value = activated.dataSync()[0];
        return Number.isFinite(value) ? value : 0;
    });
}

/**
 * Estimates sentiment locally using a lightweight heuristic model.
 * @param {Array<string>} [texts=[]] - Text snippets to analyse.
 * @returns {Promise} Sentiment scores between -1 and 1.
 */
export async function classifySentimentsLocal(texts = []) {
    if (!Array.isArray(texts) || !texts.length) {
        return [];
    }
    return texts.map((text) => {
        const features = extractFeatures(text);
        const score = scoreFromFeatures(features);
        const clamped = Math.max(-1, Math.min(1, score));
        return Number.isFinite(clamped) ? clamped : 0;
    });
}

/**
 * Normalizes sentiment values from multiple provider formats to the [-1, 1] range.
 * @param {*} value - Raw sentiment value or object.
 * @returns {number} Normalized sentiment score.
 */
export function normalizeSentiment(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.max(-1, Math.min(1, value));
    }
    if (typeof value === "string") {
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed)) {
            return Math.max(-1, Math.min(1, parsed));
        }
    }
    if (Array.isArray(value) && value.length) {
        return normalizeSentiment(value[0]);
    }
    if (value && typeof value === "object") {
        if (typeof value.score === "number") {
            const base = Math.max(0, Math.min(1, value.score));
            if (typeof value.label === "string") {
                const lower = value.label.toLowerCase();
                if (lower.includes("neg")) {
                    return -base;
                }
                if (lower.includes("pos")) {
                    return base;
                }
                if (lower.includes("neu")) {
                    return 0;
                }
            }
            return base * 2 - 1;
        }
        const keys = Object.keys(value);
        if (keys.length) {
            const positive = value.positive ?? value.pos ?? value.good ?? null;
            const negative = value.negative ?? value.neg ?? value.bad ?? null;
            const neutral = value.neutral ?? value.neu ?? null;
            if ([positive, negative, neutral].some((v) => typeof v === "number")) {
                const posScore = Number(positive ?? 0);
                const negScore = Number(negative ?? 0);
                if (posScore === 0 && negScore === 0 && typeof neutral === "number") {
                    return 0;
                }
                const total = Math.max(1e-6, Math.abs(posScore) + Math.abs(negScore));
                const diff = (posScore - negScore) / total;
                return Math.max(-1, Math.min(1, diff));
            }
        }
    }
    return 0;
}

/**
 * Restricts a sentiment score to the valid range.
 * @param {number} value - Sentiment score to clamp.
 * @returns {number} Clamped value between -1 and 1.
 */
export function clampSentiment(value) {
    return Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
}
