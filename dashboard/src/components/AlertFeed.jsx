import React from "react";

function formatTimestamp(value) {
    if (!value) {
        return "—";
    }
    const date = new Date(value);
    return date.toLocaleString();
}

export default function AlertFeed({ alerts }) {
    return (
        <section className="panel">
            <div className="panel-header">
                <h2>Alerts</h2>
                <p className="panel-subtitle">Most recent alert deliveries.</p>
            </div>
            <ul className="alert-feed">
                {alerts.length === 0 && <li className="alert-empty">No alerts recorded yet.</li>}
                {alerts.map(alert => (
                    <li key={alert.id ?? `${alert.timestamp}-${alert.message}`}
                        className={`alert-item alert-${alert.messageType ?? "generic"}`}>
                        <header>
                            <span className="alert-asset">{alert.asset ?? "GLOBAL"}</span>
                            <span className="alert-time">{formatTimestamp(alert.timestamp)}</span>
                        </header>
                        <p>{alert.message}</p>
                        {alert.timeframe && <footer>Scope: {alert.timeframe}</footer>}
                    </li>
                ))}
            </ul>
        </section>
    );
}
