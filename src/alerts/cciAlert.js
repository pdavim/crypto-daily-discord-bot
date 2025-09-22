export default function cciAlert({ cciSeries, thresholds }) {
    const alerts = [];
    const cci = cciSeries?.at(-1);
    const { cciOverbought, cciOversold } = thresholds ?? {};

    if (cci != null && cciOverbought != null && cci > cciOverbought) {
        alerts.push("📉 CCI overbought");
    }
    if (cci != null && cciOversold != null && cci < cciOversold) {
        alerts.push("📈 CCI oversold");
    }

    return alerts;
}
