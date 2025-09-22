import { ALERT_LEVELS, ALERT_CATEGORIES, createAlert } from './shared.js';

export default function maPriceAlert({ ma20, ma50, ma200, lastClose, closes }) {
    const alerts = [];
    const price = lastClose;
    const prevPrice = closes?.at(-2);
    const ma20Val = ma20?.at(-1);
    const ma50Val = ma50?.at(-1);
    const ma200Val = ma200?.at(-1);

    if (price != null && prevPrice != null && ma20Val != null) {
        if (price > ma20Val && prevPrice <= ma20Val) {
            alerts.push(createAlert("📈 Price crossed above MA20", ALERT_LEVELS.MEDIUM, ALERT_CATEGORIES.TREND));
        }
        if (price < ma20Val && prevPrice >= ma20Val) {
            alerts.push(createAlert("📉 Price crossed below MA20", ALERT_LEVELS.MEDIUM, ALERT_CATEGORIES.TREND));
        }
    }
    if (price != null && prevPrice != null && ma50Val != null) {
        if (price > ma50Val && prevPrice <= ma50Val) {
            alerts.push(createAlert("📈 Price crossed above MA50", ALERT_LEVELS.MEDIUM, ALERT_CATEGORIES.TREND));
        }
        if (price < ma50Val && prevPrice >= ma50Val) {
            alerts.push(createAlert("📉 Price crossed below MA50", ALERT_LEVELS.MEDIUM, ALERT_CATEGORIES.TREND));
        }
    }
    if (price != null && prevPrice != null && ma200Val != null) {
        if (price > ma200Val && prevPrice <= ma200Val) {
            alerts.push(createAlert("📈 Price crossed above MA200", ALERT_LEVELS.HIGH, ALERT_CATEGORIES.TREND));
        }
        if (price < ma200Val && prevPrice >= ma200Val) {
            alerts.push(createAlert("📉 Price crossed below MA200", ALERT_LEVELS.HIGH, ALERT_CATEGORIES.TREND));
        }
    }

    return alerts;
}
