export function atrStopTarget(entry, atr, { side = 'long', atrMultiplier = 1, targetMultiplier = 2 } = {}) {
    if (entry == null || atr == null) return {};
    const dir = side === 'long' ? 1 : -1;
    const stop = entry - dir * atr * atrMultiplier;
    const target = entry + dir * atr * targetMultiplier;
    return { stop, target };
}

export function positionSize(equity, riskPct, entry, stop) {
    if ([equity, riskPct, entry, stop].some(v => v == null)) return 0;
    const riskAmount = equity * riskPct;
    const perUnitRisk = Math.abs(entry - stop);
    if (perUnitRisk === 0) return 0;
    return riskAmount / perUnitRisk;
}
