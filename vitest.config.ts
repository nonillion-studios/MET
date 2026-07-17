import { defineConfig } from 'vitest/config';

/**
 * Unit tests only — pure logic, no DOM, no browser.
 *
 * `e2e/` is excluded deliberately: those are Playwright specs driving a real browser via
 * `npm run test:e2e`, and vitest would otherwise collect them and fail on Playwright's test API.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
