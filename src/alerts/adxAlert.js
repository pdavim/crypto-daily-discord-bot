import { ALERT_LEVELS, createAlert } from './shared.js';

export default function adxAlert({ adxSeries, thresholds }) {
    const alerts = [];
    const adx = adxSeries?.at(-1);
    const { adxStrongTrend } = thresholds ?? {};
    if (adx != null && adxStrongTrend != null && adx >= adxStrongTrend) {
        alerts.push(createAlert("💪 ADX>25 (tendência forte)", ALERT_LEVELS.HIGH));
    }
    return alerts;
}
