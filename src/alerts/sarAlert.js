export default function sarAlert({ sarSeries, lastClose }) {
    const alerts = [];
    const price = lastClose;
    const sar = sarSeries?.at(-1);
    const prevSar = sarSeries?.at(-2);

    if (price != null && sar != null && prevSar != null) {
        if (prevSar < price && sar > price) {
            alerts.push("📉 Parabolic SAR flip bearish");
        }
        if (prevSar > price && sar < price) {
            alerts.push("📈 Parabolic SAR flip bullish");
        }
    }

    return alerts;
}
