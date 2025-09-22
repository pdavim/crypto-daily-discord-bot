import { crossUp, crossDown } from '../indicators.js';
import { ALERT_LEVELS, createAlert } from './shared.js';

export default function maCrossoverAlert({ ma20, ma50, ma200 }) {
    if (!Array.isArray(ma20) || !Array.isArray(ma50)) {
        return [];
    }

    const alerts = [];
    if (crossUp(ma20, ma50)) {
        alerts.push(createAlert("📈 Golden cross 20/50", ALERT_LEVELS.HIGH));
    }
    if (crossDown(ma20, ma50)) {
        alerts.push(createAlert("📉 Death cross 20/50", ALERT_LEVELS.HIGH));
    }
    if (Array.isArray(ma200)) {
        if (crossUp(ma50, ma200)) {
            alerts.push(createAlert("📈 Golden cross 50/200", ALERT_LEVELS.HIGH));
        }
        if (crossDown(ma50, ma200)) {
            alerts.push(createAlert("📉 Death cross 50/200", ALERT_LEVELS.HIGH));
        }
    }
    return alerts;
}
