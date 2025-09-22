import { ALERT_LEVELS, createAlert } from './shared.js';

export default function vwapAlert({ vwapSeries, closes, lastClose }) {
    const alerts = [];
    const vwap = vwapSeries?.at(-1);
    const prevVwap = vwapSeries?.at(-2);
    const price = lastClose;
    const prevPrice = closes?.at(-2);

    if (vwap != null && price != null && prevPrice != null && prevVwap != null) {
        if (price > vwap && prevPrice <= prevVwap) {
            alerts.push(createAlert("📈 Price crossed above VWAP", ALERT_LEVELS.MEDIUM));
        }
        if (price < vwap && prevPrice >= prevVwap) {
            alerts.push(createAlert("📉 Price crossed below VWAP", ALERT_LEVELS.MEDIUM));
        }
    }

    return alerts;
}
