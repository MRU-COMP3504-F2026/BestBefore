import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['server/src/**/*.test.ts'],
    // Placeholders so modules can load; tests never reach the network.
    env: {
      DATABASE_URL: 'postgresql://test:test@localhost/test',
      NEON_AUTH_URL: 'https://auth.test.invalid/neondb/auth',
    },
  },
})
