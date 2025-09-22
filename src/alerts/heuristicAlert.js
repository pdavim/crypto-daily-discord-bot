import { ALERT_LEVELS, ALERT_CATEGORIES, createAlert } from './shared.js';

export default function heuristicAlert({ heuristicSeries, thresholds }) {
    const alerts = [];
    const heuristic = heuristicSeries?.at(-1);
    const { heuristicHigh, heuristicLow } = thresholds ?? {};

    if (heuristic != null && heuristicHigh != null && heuristic > heuristicHigh) {
        alerts.push(createAlert("🌟 Heuristic score very high", ALERT_LEVELS.HIGH, ALERT_CATEGORIES.MOMENTUM));
    }
    if (heuristic != null && heuristicLow != null && heuristic < heuristicLow) {
        alerts.push(createAlert("⚠️ Heuristic score very low", ALERT_LEVELS.HIGH, ALERT_CATEGORIES.MOMENTUM));
    }

    return alerts;
}
