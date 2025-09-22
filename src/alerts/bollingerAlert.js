import { isBBSqueeze } from '../indicators.js';
import { ALERT_LEVELS, ALERT_CATEGORIES, createAlert } from './shared.js';

export default function bollingerAlert({ bbWidth, lastClose, upperBB, lowerBB, upperKC, lowerKC }) {
    const alerts = [];
    const price = lastClose;
    const upper = upperBB?.at(-1);
    const lower = lowerBB?.at(-1);
    const upperKeltner = upperKC?.at(-1);
    const lowerKeltner = lowerKC?.at(-1);

    if (Array.isArray(bbWidth) && bbWidth.length > 0 && isBBSqueeze(bbWidth)) {
        alerts.push(createAlert("🧨 BB squeeze (compressão)", ALERT_LEVELS.MEDIUM, ALERT_CATEGORIES.VOLATILITY));
    }
    if (price != null && upper != null && price > upper) {
        alerts.push(createAlert("📈 BB breakout above", ALERT_LEVELS.HIGH, ALERT_CATEGORIES.VOLATILITY));
    }
    if (price != null && lower != null && price < lower) {
        alerts.push(createAlert("📉 BB breakout below", ALERT_LEVELS.HIGH, ALERT_CATEGORIES.VOLATILITY));
    }
    if (price != null && upperKeltner != null && price > upperKeltner) {
        alerts.push(createAlert("📈 KC breakout above", ALERT_LEVELS.HIGH, ALERT_CATEGORIES.VOLATILITY));
    }
    if (price != null && lowerKeltner != null && price < lowerKeltner) {
        alerts.push(createAlert("📉 KC breakout below", ALERT_LEVELS.HIGH, ALERT_CATEGORIES.VOLATILITY));
    }

    return alerts;
}
