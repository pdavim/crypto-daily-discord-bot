import { ALERT_LEVELS, createAlert } from './shared.js';

export default function williamsAlert({ willrSeries, thresholds }) {
    const alerts = [];
    const willr = willrSeries?.at(-1);
    const { williamsROverbought, williamsROversold } = thresholds ?? {};

    if (willr != null && williamsROverbought != null && willr > williamsROverbought) {
        alerts.push(createAlert("📉 Williams %R overbought", ALERT_LEVELS.MEDIUM));
    }
    if (willr != null && williamsROversold != null && willr < williamsROversold) {
        alerts.push(createAlert("📈 Williams %R oversold", ALERT_LEVELS.MEDIUM));
    }

    return alerts;
}
