// Vite build config — focused on load-time perf.
// Splits three.js into its own chunk so the main app code can update without
// busting the (huge, stable) three.js cache, and so the browser can fetch
// them in parallel.

import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

export default defineConfig({
  plugins: [
    {
      name: 'serve-static-subdir-index',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          // Serve index.html for /2d-website and /2d-website/ in dev mode,
          // matching what Vercel does in production with directory indexes.
          if (req.url === '/2d-website' || req.url === '/2d-website/') {
            const filePath = path.resolve(__dirname, 'public/2d-website/index.html');
            res.setHeader('Content-Type', 'text/html');
            res.end(fs.readFileSync(filePath, 'utf-8'));
            return;
          }
          if (req.url === '/bmo_desktop' || req.url === '/bmo_desktop/') {
            const filePath = path.resolve(__dirname, 'public/bmo_desktop.html');
            res.setHeader('Content-Type', 'text/html');
            res.end(fs.readFileSync(filePath, 'utf-8'));
            return;
          }
          next();
        });
      }
    }
  ],
  build: {
    // Modern browsers only — smaller output, no legacy transpile bloat.
    target: 'esnext',
    // Inline anything under 4KB as a data URI; saves a roundtrip for the
    // little SVG/PNG bits without bloating the main JS for big assets.
    assetsInlineLimit: 4096,
    // Default minifier (esbuild) — fast and produces small output.
    minify: 'esbuild',
    // Don't ship source maps to production (they're large and not needed
    // for the live site). Flip to 'hidden' if you want them uploaded
    // separately to an error tracker later.
    sourcemap: false,
    // CSS minification + code-splitting in case CSS is added later.
    cssMinify: 'esbuild',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        // Split three.js core + addons into their own chunks so the main
        // bundle stays small and three.js gets cached separately across
        // deploys (its version rarely changes).
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('three/examples') || id.includes('three/addons')) {
              return 'three-addons';
            }
            if (id.includes('three')) {
              return 'three-core';
            }
            return 'vendor';
          }
        },
        // Stable, content-hashed filenames so HTTP caching is effective.
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
    // Warn at a higher chunk size since three.js itself is unavoidably ~600KB.
    chunkSizeWarningLimit: 800,
  },
});
