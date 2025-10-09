import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import react from "@vitejs/plugin-react";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        host: true,
    },
    preview: {
        port: 4173,
        host: true,
    },
    test: {
        environment: "jsdom",
        setupFiles: resolve(__dirname, "tests/setup.js"),
    },
});
