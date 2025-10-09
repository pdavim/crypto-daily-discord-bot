const DEFAULT_BASE_URL = import.meta.env.VITE_API_BASE?.replace(/\/$/, "") || "http://localhost:3100";

function buildUrl(base, path) {
    if (!path.startsWith("/")) {
        return `${base}/${path}`;
    }
    return `${base}${path}`;
}

async function request(baseUrl, path, { method = "GET", token, body } = {}) {
    const headers = { Accept: "application/json" };
    const options = { method, headers };
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    if (body !== undefined) {
        headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(body);
    }
    const res = await fetch(buildUrl(baseUrl, path), options);
    if (res.status === 204) {
        return null;
    }
    const contentType = res.headers.get("content-type") ?? "";
    const isJson = contentType.includes("application/json");
    const payload = isJson ? await res.json() : await res.text();
    if (!res.ok) {
        const error = new Error(typeof payload === "string" ? payload : payload?.error ?? "Request failed");
        error.status = res.status;
        error.payload = payload;
        throw error;
    }
    return payload;
}

export function createDashboardClient({ baseUrl = DEFAULT_BASE_URL } = {}) {
    const normalizedBase = baseUrl.replace(/\/$/, "");

    const withTokenQuery = (path, token) => {
        if (!token) {
            return buildUrl(normalizedBase, path);
        }
        const url = new URL(buildUrl(normalizedBase, path));
        url.searchParams.set("token", token);
        return url.toString();
    };

    return {
        baseUrl: normalizedBase,
        login: (token) => request(normalizedBase, "/api/auth/login", { method: "POST", token, body: { token } }),
        fetchAssets: (token) => request(normalizedBase, "/api/assets", { token }),
        fetchAlerts: (token) => request(normalizedBase, "/api/alerts?limit=50", { token }),
        fetchPortfolio: (token) => request(normalizedBase, "/api/portfolio", { token }),
        fetchHealth: (token) => request(normalizedBase, "/api/health", { token }),
        withTokenQuery,
    };
}
