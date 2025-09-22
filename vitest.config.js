import { defineConfig } from 'vitest/config';

const isCI = process.env.CI === 'true';

export default defineConfig({
  test: {
    coverage: {
      reporter: ['text', 'lcov'],
      thresholds: isCI
        ? undefined
        : {
            statements: 70,
            branches: 70,
          },
    },
  },
});
