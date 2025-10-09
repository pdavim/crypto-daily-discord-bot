import React, { useMemo } from "react";

function toPoint(index, value, length, minValue, maxValue) {
    if (length <= 1) {
        return { x: 0, y: 50 };
    }
    const range = maxValue - minValue || 1;
    const x = (index / (length - 1)) * 100;
    const y = 100 - ((value - minValue) / range) * 100;
    return { x, y };
}

export default function EquityCurve({ trades }) {
    const points = useMemo(() => {
        const entries = Array.isArray(trades) ? trades : [];
        let cumulative = 0;
        const values = entries.map(trade => {
            const pnl = Number.isFinite(trade?.pnl) ? trade.pnl : 0;
            cumulative += pnl;
            return cumulative;
        });
        if (values.length === 0) {
            return "0,100 100,100";
        }
        const minValue = Math.min(...values, 0);
        const maxValue = Math.max(...values, 0);
        return values
            .map((value, index) => toPoint(index, value, values.length, minValue, maxValue))
            .map(({ x, y }) => `${x},${y}`)
            .join(" ");
    }, [trades]);

    return (
        <svg className="equity-curve" viewBox="0 0 100 100" preserveAspectRatio="none">
            <polyline points={points} fill="none" stroke="var(--accent-color)" strokeWidth="2" />
        </svg>
    );
}
