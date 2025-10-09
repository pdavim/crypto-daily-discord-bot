import React from "react";
import AssetGrid from "./AssetGrid.jsx";
import AlertFeed from "./AlertFeed.jsx";
import PortfolioPanel from "./PortfolioPanel.jsx";
import HealthPanel from "./HealthPanel.jsx";

export default function DashboardView({ data, token, client, onRefresh, onLogout }) {
    return (
        <div className="dashboard-layout">
            <header className="dashboard-header">
                <div>
                    <h1>Crypto Daily Operations</h1>
                    <p>Live trading telemetry and forecasting snapshots.</p>
                </div>
                <div className="header-actions">
                    <button type="button" onClick={onRefresh}>Refresh now</button>
                    <button type="button" onClick={onLogout} className="secondary">Sign out</button>
                </div>
            </header>
            <main>
                <AssetGrid assets={data.assets} token={token} client={client} />
                <div className="two-column">
                    <AlertFeed alerts={data.alerts} />
                    <PortfolioPanel portfolio={data.portfolio} />
                </div>
                <HealthPanel health={data.health} />
            </main>
        </div>
    );
}
