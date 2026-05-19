import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// Forge serves the resource as a static directory inside an iframe with
// arbitrary path. Relative asset URLs (`./assets/...`) are required so the
// generated index.html resolves correctly regardless of where Forge mounts it.
export default defineConfig({
  root: here,
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve(here, 'build'),
    emptyOutDir: true,
    sourcemap: true,
  },
});
