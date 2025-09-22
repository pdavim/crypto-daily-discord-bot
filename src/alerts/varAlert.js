import { ALERT_LEVELS, createAlert } from './shared.js';

export default function varAlert({ var24h }) {
    if (var24h == null) {
        return [];
    }
    const prefix = var24h > 0 ? '+' : '';
    return [createAlert(`📊 Var24h: ${prefix}${(var24h * 100).toFixed(2)}%`, ALERT_LEVELS.LOW)];
}
