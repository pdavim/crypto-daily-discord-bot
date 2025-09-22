export default function highLowAlert({ highs, lows, lastClose }) {
    const alerts = [];
    const price = lastClose;
    const high20 = highs?.slice(-20);
    const low20 = lows?.slice(-20);
    const maxHigh = high20 && high20.length ? Math.max(...high20) : undefined;
    const minLow = low20 && low20.length ? Math.min(...low20) : undefined;

    if (price != null && maxHigh != null && price >= maxHigh) {
        alerts.push("🚀 New 20-period high");
    }
    if (price != null && minLow != null && price <= minLow) {
        alerts.push("⚠️ New 20-period low");
    }

    return alerts;
}
