import { atrStopTarget, positionSize } from '../trading/risk.js';
import { ALERT_LEVELS, createAlert } from './shared.js';
import { computeTargetProfit, getDefaultMinimumProfitThreshold } from '../minimumProfit.js';

function formatPercent(value) {
    if (!Number.isFinite(value)) {
        return '0.00';
    }
    return value % 1 === 0 ? value.toFixed(0) : value.toFixed(2);
}

export default function tradeLevelsAlert({ lastClose, atrSeries, equity, riskPct }) {
    const alerts = [];
    const price = lastClose;
    const atr = atrSeries?.at(-1);

    if (equity != null && riskPct != null && price != null && atr != null) {
        const { stop, target } = atrStopTarget(price, atr);
        const size = positionSize(equity, riskPct, price, stop);
        if (stop != null && target != null && Number.isFinite(size)) {
            const profitRatio = computeTargetProfit(price, target);
            const threshold = getDefaultMinimumProfitThreshold();
            const profitPercent = Number.isFinite(profitRatio) ? profitRatio * 100 : null;
            const thresholdPercent = Number.isFinite(threshold) ? threshold * 100 : 0;
            const profitText = formatPercent(profitPercent ?? 0);
            const thresholdText = formatPercent(thresholdPercent);
            const baseMessage = `Stop ${stop.toFixed(4)} / Target ${target.toFixed(4)} / Size ${size.toFixed(4)}`;
            if (Number.isFinite(profitRatio) && profitRatio < threshold) {
                alerts.push(createAlert(
                    `⚠️ ${baseMessage} — Lucro potencial ${profitText}% abaixo do mínimo ${thresholdText}%`,
                    ALERT_LEVELS.LOW
                ));
            } else {
                alerts.push(createAlert(
                    `🎯 ${baseMessage} — Lucro potencial ${profitText}% (mínimo ${thresholdText}%)`,
                    ALERT_LEVELS.LOW
                ));
            }
        }
    }

    return alerts;
}
