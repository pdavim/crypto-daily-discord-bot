import { ALERT_LEVELS, createAlert } from './shared.js';

export default function priceInfoAlert({ lastClose }) {
    if (lastClose == null) {
        return [];
    }
    return [createAlert(`💰 Preço: ${lastClose.toFixed(4)}`, ALERT_LEVELS.LOW)];
}
