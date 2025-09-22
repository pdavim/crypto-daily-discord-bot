import { crossUp, crossDown } from '../indicators.js';
import { ALERT_LEVELS, ALERT_CATEGORIES, createAlert } from './shared.js';

export default function macdAlert({ macdObj }) {
    const alerts = [];
    const macd = macdObj?.macd?.at(-1);
    const macdSignal = macdObj?.signal?.at(-1);
    const macdHist = macdObj?.hist;
    const prevMacd = macdObj?.macd?.at(-2);
    const prevSignal = macdObj?.signal?.at(-2);

    if (macd != null && macdSignal != null && prevMacd != null && prevSignal != null) {
        if (prevMacd < prevSignal && macd > macdSignal) {
            alerts.push(createAlert("📈 MACD bullish crossover", ALERT_LEVELS.HIGH, ALERT_CATEGORIES.MOMENTUM));
        }
        if (prevMacd > prevSignal && macd < macdSignal) {
            alerts.push(createAlert("📉 MACD bearish crossover", ALERT_LEVELS.HIGH, ALERT_CATEGORIES.MOMENTUM));
        }
    }

    if (macdHist && macdHist.length >= 2) {
        const zeros = Array(macdHist.length).fill(0);
        if (crossUp(macdHist, zeros)) {
            alerts.push(createAlert("📈 MACD flip ↑", ALERT_LEVELS.MEDIUM, ALERT_CATEGORIES.MOMENTUM));
        }
        if (crossDown(macdHist, zeros)) {
            alerts.push(createAlert("📉 MACD flip ↓", ALERT_LEVELS.MEDIUM, ALERT_CATEGORIES.MOMENTUM));
        }
    }

    return alerts;
}
