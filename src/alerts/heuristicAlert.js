export default function heuristicAlert({ heuristicSeries, thresholds }) {
    const alerts = [];
    const heuristic = heuristicSeries?.at(-1);
    const { heuristicHigh, heuristicLow } = thresholds ?? {};

    if (heuristic != null && heuristicHigh != null && heuristic > heuristicHigh) {
        alerts.push("🌟 Heuristic score very high");
    }
    if (heuristic != null && heuristicLow != null && heuristic < heuristicLow) {
        alerts.push("⚠️ Heuristic score very low");
    }

    return alerts;
}
