export default function stochasticAlert({ stochasticK, thresholds }) {
    const alerts = [];
    const stochK = stochasticK?.at(-1);
    const { stochasticOverbought, stochasticOversold } = thresholds ?? {};

    if (stochK != null && stochasticOverbought != null && stochK > stochasticOverbought) {
        alerts.push("📉 Stochastic overbought");
    }
    if (stochK != null && stochasticOversold != null && stochK < stochasticOversold) {
        alerts.push("📈 Stochastic oversold");
    }

    return alerts;
}
