export default function emaCrossoverAlert({ ema9, ema21 }) {
    const alerts = [];
    const ema9Val = ema9?.at(-1);
    const ema21Val = ema21?.at(-1);
    const prevEma9 = ema9?.at(-2);
    const prevEma21 = ema21?.at(-2);

    if (ema9Val != null && ema21Val != null && prevEma9 != null && prevEma21 != null) {
        if (prevEma9 < prevEma21 && ema9Val > ema21Val) {
            alerts.push("📈 EMA 9/21 bullish crossover");
        }
        if (prevEma9 > prevEma21 && ema9Val < ema21Val) {
            alerts.push("📉 EMA 9/21 bearish crossover");
        }
    }

    return alerts;
}
