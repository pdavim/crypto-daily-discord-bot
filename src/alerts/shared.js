export const ALERT_LEVELS = Object.freeze({
    HIGH: 'high',
    MEDIUM: 'medium',
    LOW: 'low'
});

export function createAlert(msg, level = ALERT_LEVELS.MEDIUM) {
    return { msg, level };
}
