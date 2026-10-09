const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests', testMatch: '**/*.spec.js', workers: 1,
  use: { browserName: 'chromium', headless: true, trace: 'off' },
  webServer: { command: 'node tests/serve.cjs', url: 'http://127.0.0.1:8765/hanshoku-kanri-okayama/', reuseExistingServer: !process.env.CI }
});
