import React from "react";
import ChartPreview from "./ChartPreview.jsx";

function formatNumber(value, { digits = 4, suffix = "" } = {}) {
    if (value == null || Number.isNaN(Number(value))) {
        return "—";
    }
    return `${Number(value).toFixed(digits)}${suffix}`;
}

export default function AssetGrid({ assets, token, client }) {
    const buildChartUrl = (path) => client?.withTokenQuery?.(path, token) ?? path;
    return (
        <section className="panel">
            <div className="panel-header">
                <h2>Assets</h2>
                <p className="panel-subtitle">Latest forecasts and metadata.</p>
            </div>
            <div className="asset-grid">
                {assets.map(asset => {
                    const chartSrc = asset.chartPaths?.length ? buildChartUrl(asset.chartPaths[0]) : null;
                    const forecasts = Object.entries(asset.forecasts ?? {});
                    return (
                        <article className="asset-card" key={asset.key}>
                            <header>
                                <h3>{asset.key}</h3>
                                <span className="exchange-label">{asset.exchange?.toUpperCase()}</span>
                            </header>
                            <dl className="asset-metadata">
                                <div>
                                    <dt>Symbol</dt>
                                    <dd>{asset.symbol}</dd>
                                </div>
                                {asset.marketCapRank != null && (
                                    <div>
                                        <dt>Market Cap Rank</dt>
                                        <dd>#{asset.marketCapRank}</dd>
                                    </div>
                                )}
                            </dl>
                            <ChartPreview src={chartSrc} alt={`${asset.key} forecast chart`} />
                            <div className="forecast-list">
                                {forecasts.length === 0 && <p>No forecast snapshots stored yet.</p>}
                                {forecasts.map(([timeframe, snapshot]) => (
                                    <div key={timeframe} className="forecast-entry">
                                        <h4>{timeframe.toUpperCase()}</h4>
                                        <ul>
                                            <li>
                                                <strong>Forecast</strong>
                                                <span>{formatNumber(snapshot.forecastClose)}</span>
                                            </li>
                                            <li>
                                                <strong>Last Close</strong>
                                                <span>{formatNumber(snapshot.lastClose)}</span>
                                            </li>
                                            <li>
                                                <strong>Delta</strong>
                                                <span>{formatNumber(snapshot.delta, { digits: 4 })}</span>
                                            </li>
                                            <li>
                                                <strong>Confidence</strong>
                                                <span>{formatNumber(snapshot.confidence, { digits: 2 })}</span>
                                            </li>
                                        </ul>
                                    </div>
                                ))}
                            </div>
                        </article>
                    );
                })}
            </div>
        </section>
    );
}
