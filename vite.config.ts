import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/** Personal text stays outside the bundle: served in dev, copied beside the build, so Dad can edit it. */
function personalFile(): Plugin {
  const src = resolve(import.meta.dirname, 'src/data/personal.json');
  let outDir = resolve(import.meta.dirname, 'dist');
  return {
    name: 'personal-file',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use('/personal.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(existsSync(src) ? readFileSync(src) : '{}');
      });
    },
    closeBundle() {
      if (existsSync(src) && existsSync(outDir)) copyFileSync(src, resolve(outDir, 'personal.json'));
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [personalFile()],
  server: { port: 5173, strictPort: true, host: '127.0.0.1' },
  build: {
    target: 'es2023',
    chunkSizeWarningLimit: 4000,
    rollupOptions: { output: { manualChunks: (id) => (id.includes('node_modules/phaser') ? 'phaser' : undefined) } },
  },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
