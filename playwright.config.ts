import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  // tests/pwa só roda no projeto 'pwa'
  timeout: 180_000,
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:4173/',
    trace: 'retain-on-failure',
    serviceWorkers: 'block'
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } }, grepInvert: /@phone/ },
    { name: 'phone', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 667 } }, grep: /@phone/ },
    // build do GitHub Pages, com service worker de verdade (os outros projetos bloqueiam o service worker)
    { name: 'pwa', testDir: 'tests/pwa', use: { ...devices['Desktop Chrome'], serviceWorkers: 'allow' } }
  ],
  webServer: [
    {
      command: 'npx vite preview --port 4173 --strictPort',
      url: 'http://localhost:4173/',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000
    },
    {
      command: 'npx vite build --outDir .pages-dist --emptyOutDir && npx vite preview --outDir .pages-dist --port 4174 --strictPort',
      url: 'http://localhost:4174/mundial-de-clubes/',
      env: { BASE: '/mundial-de-clubes/' },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000
    }
  ]
});
