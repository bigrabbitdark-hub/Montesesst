import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: { viewport: { width: 1440, height: 960 }, baseURL: 'http://localhost:3000' },
  webServer: { command: 'npm run dev', port: 3000, reuseExistingServer: true },
});
