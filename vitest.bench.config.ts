import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: ['./packages/seeqlite/bench/setup.ts'],
    projects: [
      {
        test: {
          name: 'node',
          execArgv: ['--import', 'tsx'],
          experimental: { viteModuleRunner: false },
        },
      },
      {
        test: {
          sequence: { groupOrder: 1 },
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({ launchOptions: { channel: 'chrome' } }),
            instances: [{ browser: 'chromium', name: 'chrome' }],
          },
        },
      },
    ],
  },
})
