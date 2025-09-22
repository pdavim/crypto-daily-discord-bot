import { isBBSqueeze } from '../indicators.js';

export default function bollingerAlert({ bbWidth, lastClose, upperBB, lowerBB, upperKC, lowerKC }) {
    const alerts = [];
    const price = lastClose;
    const upper = upperBB?.at(-1);
    const lower = lowerBB?.at(-1);
    const upperKeltner = upperKC?.at(-1);
    const lowerKeltner = lowerKC?.at(-1);

    if (Array.isArray(bbWidth) && bbWidth.length > 0 && isBBSqueeze(bbWidth)) {
        alerts.push("🧨 BB squeeze (compressão)");
    }
    if (price != null && upper != null && price > upper) {
        alerts.push("📈 BB breakout above");
    }
    if (price != null && lower != null && price < lower) {
        alerts.push("📉 BB breakout below");
    }
    if (price != null && upperKeltner != null && price > upperKeltner) {
        alerts.push("📈 KC breakout above");
    }
    if (price != null && lowerKeltner != null && price < lowerKeltner) {
        alerts.push("📉 KC breakout below");
    }

    return alerts;
}
