import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const at = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  test: {
    // A suíte E2E é do Playwright, não do Vitest.
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
  },
  resolve: {
    alias: {
      '@domino/rules': at('./packages/rules/src/index.ts'),
      '@domino/bot': at('./packages/bot/src/index.ts'),
      '@domino/store/redis': at('./packages/store/src/redis.ts'),
      '@domino/store': at('./packages/store/src/index.ts'),
      '@domino/protocol/validate': at('./packages/protocol/src/validate.ts'),
      '@domino/protocol': at('./packages/protocol/src/index.ts'),
      '@domino/room': at('./packages/room/src/index.ts'),
    },
  },
});
