export const DECISION_LABELS = Object.freeze({
    BUY: "buy",
    SELL: "sell",
    HOLD: "hold",
});

function sanitizeAction(action) {
    if (typeof action !== "string") {
        return null;
    }
    const normalized = action.toLowerCase();
    if (normalized === "long" || normalized === "buy") {
        return DECISION_LABELS.BUY;
    }
    if (normalized === "short" || normalized === "sell") {
        return DECISION_LABELS.SELL;
    }
    if (normalized === "flat" || normalized === "hold") {
        return DECISION_LABELS.HOLD;
    }
    return null;
}

function sanitizePosture(posture) {
    if (typeof posture !== "string") {
        return null;
    }
    return posture.toLowerCase();
}

function toFinite(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function pickReasons(candidate) {
    if (Array.isArray(candidate) && candidate.length > 0) {
        return candidate.filter(item => typeof item === "string" && item.trim().length > 0);
    }
    return [];
}

export function deriveDecisionDetails({ strategy, posture } = {}) {
    const actionLabel = sanitizeAction(strategy?.action) ?? sanitizeAction(posture?.posture);
    const decision = actionLabel ?? DECISION_LABELS.HOLD;

    let emoji = "🟡";
    if (decision === DECISION_LABELS.BUY) {
        emoji = "🟢";
    } else if (decision === DECISION_LABELS.SELL) {
        emoji = "🔴";
    }

    const inferredPosture = sanitizePosture(strategy?.posture) ?? sanitizePosture(posture?.posture);
    const confidence = toFinite(strategy?.confidence) ?? toFinite(posture?.confidence);
    const reasons = pickReasons(strategy?.reasons);
    const fallbackReasons = reasons.length > 0 ? reasons : pickReasons(posture?.reasons);

    return {
        decision,
        emoji,
        posture: inferredPosture,
        confidence,
        reasons: fallbackReasons,
    };
}

function formatConfidence(confidence) {
    if (!Number.isFinite(confidence)) {
        return null;
    }
    return `${(confidence * 100).toFixed(0)}%`;
}

function formatPosture(posture) {
    if (typeof posture !== "string" || posture.length === 0) {
        return null;
    }
    if (posture === "bullish") {
        return "tendência de alta";
    }
    if (posture === "bearish") {
        return "tendência de baixa";
    }
    if (posture === "neutral") {
        return "neutra";
    }
    return posture;
}

export function formatDecisionLine(details) {
    if (!details) {
        return null;
    }
    const { decision, emoji, posture, confidence, reasons } = details;
    if (typeof decision !== "string") {
        return null;
    }

    const label = decision.toUpperCase();
    const segments = [`${emoji} ${label}`];

    const postureLabel = formatPosture(posture);
    if (postureLabel) {
        segments.push(`postura ${postureLabel}`);
    }

    const confidenceLabel = formatConfidence(confidence);
    if (confidenceLabel) {
        segments.push(`confiança ${confidenceLabel}`);
    }

    if (Array.isArray(reasons) && reasons.length > 0) {
        segments.push(`motivos: ${reasons.slice(0, 2).join(", ")}`);
    }

    return segments.join(" — ");
}

export const __private__ = {
    sanitizeAction,
    sanitizePosture,
    toFinite,
    pickReasons,
    formatConfidence,
    formatPosture,
};
