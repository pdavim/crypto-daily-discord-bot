import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startDashboardServer } from "../../src/dashboard/server.js";
import { CFG } from "../../src/config.js";

const TEST_TOKEN = "test-token";

function closeServer(server) {
    return new Promise(resolve => {
        if (!server) {
            resolve();
            return;
        }
        server.close(() => resolve());
    });
}

describe("dashboard server", () => {
    let server;
    let baseUrl;

    beforeAll(async () => {
        CFG.dashboard = {
            ...(CFG.dashboard ?? {}),
            enabled: true,
            port: 0,
            token: TEST_TOKEN,
        };
        server = await startDashboardServer({ port: 0, token: TEST_TOKEN, enabled: true });
        const address = server.address();
        const port = typeof address === "object" && address !== null ? address.port : 0;
        baseUrl = `http://127.0.0.1:${port}`;
    });

    afterAll(async () => {
        await closeServer(server);
    });

    it("rejects unauthorized requests", async () => {
        const res = await fetch(`${baseUrl}/api/assets`);
        expect(res.status).toBe(401);
    });

    it("accepts valid login tokens", async () => {
        const res = await fetch(`${baseUrl}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: TEST_TOKEN }),
        });
        expect(res.status).toBe(200);
        const payload = await res.json();
        expect(payload.ok).toBe(true);
        expect(payload.token).toBe(TEST_TOKEN);
    });

    it("serves assets when authorized", async () => {
        const res = await fetch(`${baseUrl}/api/assets`, {
            headers: { Authorization: `Bearer ${TEST_TOKEN}` },
        });
        expect(res.status).toBe(200);
        const payload = await res.json();
        expect(Array.isArray(payload.assets)).toBe(true);
    });
});
