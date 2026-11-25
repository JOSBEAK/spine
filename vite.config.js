import { defineConfig } from 'vite';

// Served from the root of https://spinebrew.com (GitHub Pages, custom domain). Routes are real paths, so the base must be '/'.
export default defineConfig({
  base: process.env.SPINE_BASE ?? '/',
  build: { target: 'es2020' },
});
