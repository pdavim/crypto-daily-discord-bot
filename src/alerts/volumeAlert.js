import { ALERT_LEVELS, ALERT_CATEGORIES, createAlert } from './shared.js';

export default function volumeAlert({ volumes, thresholds }) {
    const alerts = [];
    const recent = volumes?.slice(-20);
    const lastVolume = volumes?.at(-1);
    const { volumeSpike } = thresholds ?? {};

    if (recent && recent.length === 20 && lastVolume != null && volumeSpike != null) {
        const avg = recent.reduce((sum, value) => sum + value, 0) / recent.length;
        if (lastVolume > volumeSpike * avg) {
            alerts.push(createAlert("🔊 Volume spike (>2x avg)", ALERT_LEVELS.MEDIUM, ALERT_CATEGORIES.VOLATILITY));
        }
    }

    return alerts;
}
