import React, { useMemo } from "react";

function humanUptime(seconds) {
    const duration = Number(seconds) || 0;
    const hours = Math.floor(duration / 3600);
    const minutes = Math.floor((duration % 3600) / 60);
    const secs = Math.floor(duration % 60);
    return `${hours}h ${minutes}m ${secs}s`;
}

function summarizeMetrics(metrics) {
    if (!Array.isArray(metrics)) {
        return [];
    }
    return metrics
        .filter(metric => metric?.type === "counter" || metric?.type === "gauge")
        .slice(0, 10)
        .map(metric => ({
            name: metric.name,
            help: metric.help,
            value: metric.values?.[0]?.value ?? metric.values?.[0]?.sum ?? 0,
        }));
}

export default function HealthPanel({ health }) {
    const summary = useMemo(() => summarizeMetrics(health?.metrics), [health]);
    if (!health) {
        return null;
    }
    return (
        <section className="panel">
            <div className="panel-header">
                <h2>System Health</h2>
                <p className="panel-subtitle">Metrics snapshot from Prometheus registry.</p>
            </div>
            <div className="health-grid">
                <div>
                    <h3>Runtime</h3>
                    <ul>
                        <li><strong>PID</strong><span>{health.pid}</span></li>
                        <li><strong>Uptime</strong><span>{humanUptime(health.uptime)}</span></li>
                        <li><strong>RSS</strong><span>{Math.round((health.memory?.rss ?? 0) / (1024 * 1024))} MB</span></li>
                    </ul>
                </div>
                <div>
                    <h3>Highlights</h3>
                    <ul className="metric-list">
                        {summary.length === 0 && <li>No metrics published.</li>}
                        {summary.map(metric => (
                            <li key={metric.name}>
                                <strong>{metric.name}</strong>
                                <span>{metric.value}</span>
                                <small>{metric.help}</small>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </section>
    );
}
