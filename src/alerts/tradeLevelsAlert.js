import { atrStopTarget, positionSize } from '../trading/risk.js';

export default function tradeLevelsAlert({ lastClose, atrSeries, equity, riskPct }) {
    const alerts = [];
    const price = lastClose;
    const atr = atrSeries?.at(-1);

    if (equity != null && riskPct != null && price != null && atr != null) {
        const { stop, target } = atrStopTarget(price, atr);
        const size = positionSize(equity, riskPct, price, stop);
        if (stop != null && target != null && Number.isFinite(size)) {
            alerts.push(`🎯 Stop ${stop.toFixed(4)} / Target ${target.toFixed(4)} / Size ${size.toFixed(4)}`);
        }
    }

    return alerts;
}
