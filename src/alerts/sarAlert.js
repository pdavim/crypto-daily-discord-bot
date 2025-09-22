import { ALERT_LEVELS, ALERT_CATEGORIES, createAlert } from './shared.js';

export default function sarAlert({ sarSeries, lastClose }) {
    const alerts = [];
    const price = lastClose;
    const sar = sarSeries?.at(-1);
    const prevSar = sarSeries?.at(-2);

    if (price != null && sar != null && prevSar != null) {
        if (prevSar < price && sar > price) {
            alerts.push(createAlert("📉 Parabolic SAR flip bearish", ALERT_LEVELS.HIGH, ALERT_CATEGORIES.TREND));
        }
        if (prevSar > price && sar < price) {
            alerts.push(createAlert("📈 Parabolic SAR flip bullish", ALERT_LEVELS.HIGH, ALERT_CATEGORIES.TREND));
        }
    }

    return alerts;
}
