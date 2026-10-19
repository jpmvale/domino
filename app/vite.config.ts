import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * O cliente vive em `app/` e compila para `app/build/`, servido pelo processo
 * Node em produção. `build/` e não `dist/`: `dist/` é a saída do `tsc -b`.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  resolve: {
    // Os mesmos apelidos de `tsconfig.base.json`: o Vite não lê `paths`.
    alias: {
      '@domino/protocol': fileURLToPath(new URL('../packages/protocol/src/index.ts', import.meta.url)),
      '@domino/rules': fileURLToPath(new URL('../packages/rules/src/index.ts', import.meta.url)),
      '@domino/bot': fileURLToPath(new URL('../packages/bot/src/index.ts', import.meta.url)),
    },
  },
  build: {
    outDir: 'build',
    emptyOutDir: true,
    chunkSizeWarningLimit: 500,
  },
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true, ws: true },
    },
  },
});
