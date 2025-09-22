export default function williamsAlert({ willrSeries, thresholds }) {
    const alerts = [];
    const willr = willrSeries?.at(-1);
    const { williamsROverbought, williamsROversold } = thresholds ?? {};

    if (willr != null && williamsROverbought != null && willr > williamsROverbought) {
        alerts.push("📉 Williams %R overbought");
    }
    if (willr != null && williamsROversold != null && willr < williamsROversold) {
        alerts.push("📈 Williams %R oversold");
    }

    return alerts;
}
