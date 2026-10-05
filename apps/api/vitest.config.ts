import { defineConfig } from 'vitest/config';

process.env.TEST_DATABASE_URL ??= 'postgres://mypersonalfinance:change-me@localhost:5432/mypersonalfinance_test';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Integration tests share one database.
    fileParallelism: false,
    env: { TEST_DATABASE_URL: process.env.TEST_DATABASE_URL },
  },
});
