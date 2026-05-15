import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  root: 'src/web',
  publicDir: '../../public',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/web', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
    },
    // Force a single React instance across the workspace so pnpm hoisting
    // doesn't accidentally surface two physical copies, which would trip the
    // "Invalid hook call" warning the moment a hook fires.
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    // Pre-bundle React so HMR doesn't tear modules into separate JSX runtimes.
    include: ['react', 'react-dom', 'react-dom/client'],
  },
  build: {
    // Absolute path so the output lands at apps/platform/dist regardless of how
    // Vite resolves relative outDir paths against `root`. That's where
    // wrangler.toml's [assets] directory = "./dist" looks.
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  server: {
    port: 5180,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:8787',
      '/agents': {
        target: 'ws://localhost:8787',
        ws: true,
      },
    },
  },
});
