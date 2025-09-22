export default function adxAlert({ adxSeries, thresholds }) {
    const alerts = [];
    const adx = adxSeries?.at(-1);
    const { adxStrongTrend } = thresholds ?? {};
    if (adx != null && adxStrongTrend != null && adx >= adxStrongTrend) {
        alerts.push("💪 ADX>25 (tendência forte)");
    }
    return alerts;
}
