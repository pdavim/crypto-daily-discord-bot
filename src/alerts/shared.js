export const ALERT_LEVELS = Object.freeze({
    HIGH: 'high',
    MEDIUM: 'medium',
    LOW: 'low'
});

export const ALERT_CATEGORIES = Object.freeze({
    TREND: 'trend',
    MOMENTUM: 'momentum',
    VOLATILITY: 'volatility',
    INFO: 'info'
});

export const ALERT_CATEGORY_LABELS = Object.freeze({
    [ALERT_CATEGORIES.TREND]: 'Tendência',
    [ALERT_CATEGORIES.MOMENTUM]: 'Momentum',
    [ALERT_CATEGORIES.VOLATILITY]: 'Volatilidade',
    [ALERT_CATEGORIES.INFO]: 'Informação'
});

export function createAlert(msg, level = ALERT_LEVELS.MEDIUM, category = ALERT_CATEGORIES.INFO) {
    return { msg, level, category };
}
