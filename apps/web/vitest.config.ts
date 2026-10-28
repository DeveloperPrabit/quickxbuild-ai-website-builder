import path from 'node:path'
import { defineConfig } from 'vitest/config'

process.env.SKIP_ENV_VALIDATION = '1'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
    },
  },
  test: {
    environment: 'node',
    env: {
      SKIP_ENV_VALIDATION: '1',
    },
  },
})
