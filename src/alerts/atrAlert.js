import { ALERT_LEVELS, createAlert } from './shared.js';

export default function atrAlert({ atrSeries, thresholds }) {
    const alerts = [];
    const atr = atrSeries?.at(-1);
    const prevAtr = atrSeries?.at(-2);
    const { atrSpike } = thresholds ?? {};

    if (atr != null && prevAtr != null && atrSpike != null && atr > atrSpike * prevAtr) {
        alerts.push(createAlert("⚡ ATR spike (volatility)", ALERT_LEVELS.HIGH));
    }

    return alerts;
}
