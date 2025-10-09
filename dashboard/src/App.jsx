import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createDashboardClient } from "./api/client.js";
import { usePolling } from "./hooks/usePolling.js";
import LoginForm from "./components/LoginForm.jsx";
import DashboardView from "./components/DashboardView.jsx";

const STORAGE_KEY = "crypto-dashboard-token";

export default function App() {
    const apiBase = import.meta.env.VITE_API_BASE?.replace(/\/$/, "") || "http://localhost:3100";
    const client = useMemo(() => createDashboardClient({ baseUrl: apiBase }), [apiBase]);
    const [token, setToken] = useState(() => localStorage.getItem(STORAGE_KEY) ?? "");
    const [authError, setAuthError] = useState(null);
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState({ assets: [], alerts: [], portfolio: null, health: null });
    const [pollingEnabled, setPollingEnabled] = useState(Boolean(token));

    useEffect(() => {
        if (token) {
            localStorage.setItem(STORAGE_KEY, token);
        } else {
            localStorage.removeItem(STORAGE_KEY);
        }
    }, [token]);

    const loadAll = useCallback(async (authToken) => {
        if (!authToken) {
            return;
        }
        const [assetsPayload, alertsPayload, portfolioPayload, healthPayload] = await Promise.all([
            client.fetchAssets(authToken),
            client.fetchAlerts(authToken),
            client.fetchPortfolio(authToken),
            client.fetchHealth(authToken),
        ]);
        setData({
            assets: assetsPayload?.assets ?? [],
            alerts: alertsPayload?.alerts ?? [],
            portfolio: portfolioPayload?.portfolio ?? null,
            health: healthPayload ?? null,
        });
    }, [client]);

    const refresh = useCallback(async () => {
        if (!token) {
            return;
        }
        try {
            await loadAll(token);
            setAuthError(null);
        } catch (error) {
            if (error?.status === 401) {
                setAuthError("Session expired. Please sign in again.");
                setToken("");
                setPollingEnabled(false);
                setData({ assets: [], alerts: [], portfolio: null, health: null });
            } else {
                setAuthError(error?.message ?? "Failed to refresh data.");
            }
        }
    }, [token, loadAll]);

    usePolling(refresh, { enabled: pollingEnabled && Boolean(token), interval: 15000 });

    useEffect(() => {
        if (token) {
            loadAll(token).catch(error => {
                if (error?.status === 401) {
                    setToken("");
                    setPollingEnabled(false);
                } else {
                    setAuthError(error?.message ?? "Unable to load dashboard data.");
                }
            });
        }
    }, [token, loadAll]);

    const handleLogin = async (nextToken) => {
        const trimmed = nextToken.trim();
        if (!trimmed) {
            return;
        }
        setLoading(true);
        try {
            await client.login(trimmed);
            setToken(trimmed);
            setPollingEnabled(true);
            setAuthError(null);
            await loadAll(trimmed);
        } catch (error) {
            setAuthError(error?.message ?? "Authentication failed.");
            setToken("");
            setPollingEnabled(false);
            setData({ assets: [], alerts: [], portfolio: null, health: null });
        } finally {
            setLoading(false);
        }
    };

    const handleLogout = () => {
        setToken("");
        setPollingEnabled(false);
        setData({ assets: [], alerts: [], portfolio: null, health: null });
        setAuthError(null);
    };

    if (!token) {
        return <LoginForm onSubmit={handleLogin} loading={loading} error={authError} />;
    }

    return (
        <>
            {authError && <div className="banner error">{authError}</div>}
            <DashboardView data={data} token={token} client={client} onRefresh={refresh} onLogout={handleLogout} />
        </>
    );
}
