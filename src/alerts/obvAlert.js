import { ALERT_LEVELS, ALERT_CATEGORIES, createAlert } from "./shared.js";

export default function obvAlert({ obvSeries, thresholds }) {
    const alerts = [];
    const obv = obvSeries?.at(-1);
    const prevObv = obvSeries?.at(-2);
    const { obvDelta } = thresholds ?? {};

    if (obv != null && prevObv != null && obvDelta != null) {
        if (obv > prevObv * (1 + obvDelta)) {
            alerts.push(createAlert("📈 OBV bullish divergence", ALERT_LEVELS.MEDIUM, ALERT_CATEGORIES.MOMENTUM));
        }
        if (obv < prevObv * (1 - obvDelta)) {
            alerts.push(createAlert("📉 OBV bearish divergence", ALERT_LEVELS.MEDIUM, ALERT_CATEGORIES.MOMENTUM));
        }
    }

    return alerts;
}
