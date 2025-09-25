import { roundThreshold } from "../utils.js";
import { ALERT_LEVELS, createAlert } from "./shared.js";

export default function roundNumberAlert({ lastClose }) {
    const alerts = [];
    const price = lastClose;
    if (price != null) {
        const threshold = roundThreshold(price);
        if (threshold && price % threshold < threshold / 100) {
            alerts.push(createAlert("🔵 Price near round number", ALERT_LEVELS.LOW));
        }
    }
    return alerts;
}
