import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import * as client from "../src/api/client.js";
import App from "../src/App.jsx";

const mockClient = {
    login: vi.fn(),
    fetchAssets: vi.fn(),
    fetchAlerts: vi.fn(),
    fetchPortfolio: vi.fn(),
    fetchHealth: vi.fn(),
    withTokenQuery: vi.fn((path) => path),
};

function createDeferred() {
    let resolve;
    const promise = new Promise((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

function createStorage() {
    const data = new Map();
    return {
        getItem: (key) => (data.has(key) ? data.get(key) : null),
        setItem: (key, value) => {
            data.set(key, String(value));
        },
        removeItem: (key) => {
            data.delete(key);
        },
        clear: () => {
            data.clear();
        },
    };
}

describe("App", () => {
    beforeEach(() => {
        vi.spyOn(client, "createDashboardClient").mockReturnValue(mockClient);
        mockClient.login.mockResolvedValue({ ok: true });
        mockClient.fetchAssets.mockResolvedValue({ assets: [] });
        mockClient.fetchAlerts.mockResolvedValue({ alerts: [] });
        mockClient.fetchPortfolio.mockResolvedValue({ portfolio: null });
        mockClient.fetchHealth.mockResolvedValue({ uptime: 0, pid: 1, memory: {} });
        Object.defineProperty(globalThis, "localStorage", {
            configurable: true,
            value: createStorage(),
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete globalThis.localStorage;
    });

    it("renders login form by default", () => {
        render(<App />);
        expect(screen.getByText(/Crypto Daily Dashboard/)).toBeInTheDocument();
    });

    it("authenticates and shows dashboard", async () => {
        render(<App />);
        const [input] = screen.getAllByPlaceholderText(/Dashboard token/);
        fireEvent.change(input, { target: { value: "token" } });
        fireEvent.submit(input.closest("form"));
        await waitFor(() => expect(mockClient.login).toHaveBeenCalledWith("token"));
        await waitFor(() => expect(screen.getByText(/Crypto Daily Operations/)).toBeInTheDocument());
    });

    it("disables refresh button while data reload is pending", async () => {
        render(<App />);
        const [input] = screen.getAllByPlaceholderText(/Dashboard token/);
        fireEvent.change(input, { target: { value: "token" } });
        fireEvent.submit(input.closest("form"));

        await waitFor(() => expect(mockClient.login).toHaveBeenCalledWith("token"));

        const refreshButton = await screen.findByRole("button", { name: /Refresh now/i });

        const assetsDeferred = createDeferred();
        const alertsDeferred = createDeferred();
        const portfolioDeferred = createDeferred();
        const healthDeferred = createDeferred();

        mockClient.fetchAssets.mockReturnValueOnce(assetsDeferred.promise);
        mockClient.fetchAlerts.mockReturnValueOnce(alertsDeferred.promise);
        mockClient.fetchPortfolio.mockReturnValueOnce(portfolioDeferred.promise);
        mockClient.fetchHealth.mockReturnValueOnce(healthDeferred.promise);

        fireEvent.click(refreshButton);

        await waitFor(() => expect(refreshButton).toBeDisabled());
        expect(refreshButton).toHaveTextContent(/Refreshing/);

        assetsDeferred.resolve({ assets: [] });
        alertsDeferred.resolve({ alerts: [] });
        portfolioDeferred.resolve({ portfolio: null });
        healthDeferred.resolve({ uptime: 1, pid: 1, memory: {} });

        await waitFor(() => expect(refreshButton).not.toBeDisabled());
        expect(refreshButton).toHaveTextContent(/Refresh now/);
    });
});
