import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["tests/**/*.test.js"],
        exclude: ["dashboard/**"],
        setupFiles: ["./tests/setup.js"],
        coverage: {
            reporter: ["text", "lcov"],
            include: ["src/**/*.js"],
            exclude: [
                "**/node_modules/**",
                "website/**",
                "docs/**",
                "charts/**",
                "bin/**",
                "reports/**",
                "src/ai.js",
                "src/chart.js",
                "src/config.js",
                "src/discord.js",
                "src/discordBot.js",
                "src/discordRateLimit.js",
                "src/index.js",
                "src/limit.js",
                "src/logger.js",
                "src/monitor.js",
                "src/monthlyReport.js",
                "src/news.js",
                "src/newsCache.js",
                "src/perf.js",
                "src/websearch.js",
                "src/weeklySnapshots.js",
                "src/trading/**",
            ],
            thresholds: {
                statements: 80,
                branches: 60,
                functions: 75,
                lines: 80,
            },
        },
    },
});
