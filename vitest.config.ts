import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { env:{TRADING_CHAIN:'solana'}, include: ['tests/**/*.test.ts'], fileParallelism: false, pool:'threads', maxWorkers:1, testTimeout: 45000, hookTimeout: 90000 } });
