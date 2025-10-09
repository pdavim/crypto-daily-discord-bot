import React, { useEffect, useMemo, useState } from "react";

const PAGE_SIZE = 10;

function isNewsAlert(alert) {
    if (!alert?.messageType) {
        return false;
    }
    const normalized = String(alert.messageType).toLowerCase();
    return normalized === "news_digest" || normalized.includes("news");
}

function formatTimestamp(value) {
    if (!value) {
        return "—";
    }
    const date = new Date(value);
    return date.toLocaleString();
}

export default function AlertFeed({ alerts }) {
    const [page, setPage] = useState(0);

    const sortedAlerts = useMemo(() => {
        if (!Array.isArray(alerts)) {
            return [];
        }
        return [...alerts].sort((a, b) => {
            const aIsNews = isNewsAlert(a);
            const bIsNews = isNewsAlert(b);
            if (aIsNews !== bIsNews) {
                return aIsNews ? -1 : 1;
            }
            const aTime = a?.timestamp ? new Date(a.timestamp).getTime() : 0;
            const bTime = b?.timestamp ? new Date(b.timestamp).getTime() : 0;
            return bTime - aTime;
        });
    }, [alerts]);

    useEffect(() => {
        setPage(0);
    }, [alerts]);

    const pageCount = Math.max(1, Math.ceil(sortedAlerts.length / PAGE_SIZE));
    const startIndex = page * PAGE_SIZE;
    const currentAlerts = sortedAlerts.slice(startIndex, startIndex + PAGE_SIZE);

    const handlePrev = () => {
        setPage(current => Math.max(0, current - 1));
    };

    const handleNext = () => {
        setPage(current => Math.min(pageCount - 1, current + 1));
    };

    return (
        <section className="panel">
            <div className="panel-header">
                <h2>Alerts</h2>
                <p className="panel-subtitle">Most recent alert deliveries.</p>
            </div>
            <ul className="alert-feed">
                {sortedAlerts.length === 0 && <li className="alert-empty">No alerts recorded yet.</li>}
                {currentAlerts.map(alert => (
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
            {sortedAlerts.length > PAGE_SIZE && (
                <div className="alert-pagination">
                    <button type="button" onClick={handlePrev} disabled={page === 0} className="secondary">
                        Previous
                    </button>
                    <span className="alert-pagination-info">
                        Page {page + 1} of {pageCount}
                    </span>
                    <button type="button" onClick={handleNext} disabled={page >= pageCount - 1} className="secondary">
                        Next
                    </button>
                </div>
            )}
        </section>
    );
}
