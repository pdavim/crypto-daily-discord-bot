export default function trendAlert({ trendSeries }) {
    const alerts = [];
    const trend = trendSeries?.at(-1);
    if (trend === 1) {
        alerts.push("📈 Strong uptrend");
    }
    if (trend === -1) {
        alerts.push("📉 Strong downtrend");
    }
    return alerts;
}
