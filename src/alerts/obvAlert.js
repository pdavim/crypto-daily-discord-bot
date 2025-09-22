export default function obvAlert({ obvSeries, thresholds }) {
    const alerts = [];
    const obv = obvSeries?.at(-1);
    const prevObv = obvSeries?.at(-2);
    const { obvDelta } = thresholds ?? {};

    if (obv != null && prevObv != null && obvDelta != null) {
        if (obv > prevObv * (1 + obvDelta)) {
            alerts.push("📈 OBV bullish divergence");
        }
        if (obv < prevObv * (1 - obvDelta)) {
            alerts.push("📉 OBV bearish divergence");
        }
    }

    return alerts;
}
