import React, { useState } from "react";

export default function LoginForm({ onSubmit, loading, error }) {
    const [token, setToken] = useState("");

    const handleSubmit = (event) => {
        event.preventDefault();
        if (loading) {
            return;
        }
        onSubmit?.(token.trim());
    };

    return (
        <div className="login-container">
            <form className="login-form" onSubmit={handleSubmit}>
                <h1>Crypto Daily Dashboard</h1>
                <p>Enter the dashboard token configured on the server to continue.</p>
                <input
                    type="password"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    placeholder="Dashboard token"
                    autoComplete="off"
                />
                <button type="submit" disabled={loading || token.trim() === ""}>
                    {loading ? "Signing in…" : "Sign in"}
                </button>
                {error && <p className="error-text">{error}</p>}
            </form>
        </div>
    );
}
