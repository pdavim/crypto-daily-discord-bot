import { defineConfig } from 'vitest/config';

const isCI = process.env.CI === 'true';

export default defineConfig({
  test: {
    coverage: {
      reporter: ['text', 'lcov'],
      include: ['src/**/*.js'],
      exclude: [
        '**/node_modules/**',
        'website/**',
        'docs/**',
        'charts/**',
        'bin/**',
        'reports/**',
        'src/ai.js',
        'src/chart.js',
        'src/config.js',
        'src/discord.js',
        'src/discordBot.js',
        'src/discordRateLimit.js',
        'src/index.js',
        'src/limit.js',
        'src/logger.js',
        'src/monitor.js',
        'src/monthlyReport.js',
        'src/news.js',
        'src/newsCache.js',
        'src/perf.js',
        'src/websearch.js',
        'src/weeklySnapshots.js',
        'src/data/**',
        'src/trading/**',
      ],
      thresholds: isCI
        ? undefined
        : {
            statements: 80,
            branches: 60,
          },
    },
  },
});
