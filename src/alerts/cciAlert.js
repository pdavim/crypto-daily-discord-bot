import { ALERT_LEVELS, createAlert } from './shared.js';

export default function cciAlert({ cciSeries, thresholds }) {
    const alerts = [];
    const cci = cciSeries?.at(-1);
    const { cciOverbought, cciOversold } = thresholds ?? {};

    if (cci != null && cciOverbought != null && cci > cciOverbought) {
        alerts.push(createAlert("📉 CCI overbought", ALERT_LEVELS.MEDIUM));
    }
    if (cci != null && cciOversold != null && cci < cciOversold) {
        alerts.push(createAlert("📈 CCI oversold", ALERT_LEVELS.MEDIUM));
    }

    return alerts;
}
