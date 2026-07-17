import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests drive the real Studio in a real browser, which is the only way to observe the
 * Konva canvas at all — `npm test` (vitest) covers pure logic, and neither it nor `tsc` can see a
 * rendering regression.
 *
 * Kept out of `npm test` deliberately: these need a dev server and a browser binary, so they run
 * on demand via `npm run test:e2e` rather than on every unit-test run.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  // Opening the Studio means decoding a page image and mounting Konva; the default 30s is tight.
  timeout: 90_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    /**
     * Builds, then serves the built bundle — deliberately not `vite dev`.
     *
     * The dev server hot-reloads, so editing any source file while a suite is running reloads the
     * page mid-test and the run reports failures that aren't real. A preview build is frozen at the
     * moment the run started, which makes results trustworthy and lets work continue during a run.
     * It also means the suite exercises what actually ships.
     */
    command: 'npm run build && npx vite preview --port 5173 --strictPort',
    url: 'http://localhost:5173',
    // Never reuse: a stale server would serve a stale build and silently test the wrong code.
    reuseExistingServer: false,
    timeout: 180_000,
    // `supabaseClient.ts` calls createClient at module scope, so the *whole app* throws on boot
    // when these are unset — not just the Teams tab. Dummy values keep e2e self-contained rather
    // than depending on a gitignored .env.local; nothing under test talks to Supabase.
    env: {
      VITE_SUPABASE_URL: 'http://localhost:54321',
      VITE_SUPABASE_ANON_KEY: 'e2e-dummy-anon-key',
    },
  },
});
