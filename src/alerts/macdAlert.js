import { crossUp, crossDown } from '../indicators.js';

export default function macdAlert({ macdObj }) {
    const alerts = [];
    const macd = macdObj?.macd?.at(-1);
    const macdSignal = macdObj?.signal?.at(-1);
    const macdHist = macdObj?.hist;
    const prevMacd = macdObj?.macd?.at(-2);
    const prevSignal = macdObj?.signal?.at(-2);

    if (macd != null && macdSignal != null && prevMacd != null && prevSignal != null) {
        if (prevMacd < prevSignal && macd > macdSignal) {
            alerts.push("📈 MACD bullish crossover");
        }
        if (prevMacd > prevSignal && macd < macdSignal) {
            alerts.push("📉 MACD bearish crossover");
        }
    }

    if (macdHist && macdHist.length >= 2) {
        const zeros = Array(macdHist.length).fill(0);
        if (crossUp(macdHist, zeros)) {
            alerts.push("📈 MACD flip ↑");
        }
        if (crossDown(macdHist, zeros)) {
            alerts.push("📉 MACD flip ↓");
        }
    }

    return alerts;
}
