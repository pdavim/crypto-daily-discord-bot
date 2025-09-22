import { roundThreshold } from '../utils.js';

export default function roundNumberAlert({ lastClose }) {
    const alerts = [];
    const price = lastClose;
    if (price != null) {
        const threshold = roundThreshold(price);
        if (threshold && price % threshold < threshold / 100) {
            alerts.push("🔵 Price near round number");
        }
    }
    return alerts;
}
