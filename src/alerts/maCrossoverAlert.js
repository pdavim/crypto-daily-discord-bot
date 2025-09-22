import { crossUp, crossDown } from '../indicators.js';

export default function maCrossoverAlert({ ma20, ma50, ma200 }) {
    if (!Array.isArray(ma20) || !Array.isArray(ma50)) {
        return [];
    }

    const alerts = [];
    if (crossUp(ma20, ma50)) {
        alerts.push("📈 Golden cross 20/50");
    }
    if (crossDown(ma20, ma50)) {
        alerts.push("📉 Death cross 20/50");
    }
    if (Array.isArray(ma200)) {
        if (crossUp(ma50, ma200)) {
            alerts.push("📈 Golden cross 50/200");
        }
        if (crossDown(ma50, ma200)) {
            alerts.push("📉 Death cross 50/200");
        }
    }
    return alerts;
}
