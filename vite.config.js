import { defineConfig } from 'vite';

// Served from https://<user>.github.io/spine/ on GitHub Pages.
export default defineConfig({
  base: process.env.SPINE_BASE ?? '/spine/',
  build: { target: 'es2020' },
});
