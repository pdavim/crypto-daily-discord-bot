import React from "react";
import EquityCurve from "./EquityCurve.jsx";

function pct(value) {
    if (!Number.isFinite(value)) {
        return "—";
    }
    return `${(value * 100).toFixed(1)}%`;
}

function formatCurrency(value) {
    if (!Number.isFinite(value)) {
        return "—";
    }
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

export default function PortfolioPanel({ portfolio }) {
    if (!portfolio) {
        return null;
    }
    const winRate = pct(portfolio.winRate);
    const realized = formatCurrency(portfolio.realizedPnl);
    const exposure = formatCurrency(portfolio.exposure);
    const equity = formatCurrency(portfolio.accountEquity);
    return (
        <section className="panel">
            <div className="panel-header">
                <h2>Portfolio</h2>
                <p className="panel-subtitle">Execution stats from trading logs.</p>
            </div>
            <div className="portfolio-grid">
                <div>
                    <h3>Overview</h3>
                    <ul>
                        <li><strong>Total Trades</strong><span>{portfolio.totalTrades}</span></li>
                        <li><strong>Open Positions</strong><span>{portfolio.openPositions.length}</span></li>
                        <li><strong>Win Rate</strong><span>{winRate}</span></li>
                        <li><strong>Realized PnL</strong><span>{realized}</span></li>
                        <li><strong>Exposure</strong><span>{exposure}</span></li>
                        <li><strong>Configured Equity</strong><span>{equity}</span></li>
                    </ul>
                </div>
                <div>
                    <h3>Equity Curve</h3>
                    <EquityCurve trades={portfolio.closedTrades} />
                </div>
                <div>
                    <h3>Open Positions</h3>
                    <ul className="position-list">
                        {portfolio.openPositions.length === 0 && <li>No open positions.</li>}
                        {portfolio.openPositions.map(position => (
                            <li key={position.id ?? `${position.symbol}-${position.timestamp}`}>
                                <strong>{position.symbol}</strong>
                                <span>{position.side}</span>
                                <span>{position.quantity}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </section>
    );
}
