import { ALERT_LEVELS, createAlert } from './shared.js';

export default function trendAlert({ trendSeries }) {
    const alerts = [];
    const trend = trendSeries?.at(-1);
    if (trend === 1) {
        alerts.push(createAlert("📈 Strong uptrend", ALERT_LEVELS.HIGH));
    }
    if (trend === -1) {
        alerts.push(createAlert("📉 Strong downtrend", ALERT_LEVELS.HIGH));
    }
    return alerts;
}
