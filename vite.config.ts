import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
    VitePWA({
      // 2026-04-14 cache-staleness fix: was "prompt", which left users on
      // the old SW + old precached index.html indefinitely. After a deploy,
      // the old hashed chunks referenced by the cached index.html are gone
      // from the server (Vite emptyOutDir purges dist/public on rebuild),
      // producing blank-screen / React #310 mixed-bundle failures. autoUpdate
      // + skipWaiting + clientsClaim + cleanupOutdatedCaches guarantees each
      // deploy takes over all clients atomically and drops stale precaches.
      registerType: "autoUpdate",
      includeAssets: ["favicon.png", "apple-touch-icon.png"],
      manifest: {
        name: "Syntraro Field Service",
        short_name: "Syntraro",
        description: "Field service management for HVAC/R technicians",
        theme_color: "#0f1a2e",
        background_color: "#0f1a2e",
        display: "standalone",
        scope: "/",
        start_url: "/tech/today",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // 2026-04-14 cache-staleness fix:
        //   skipWaiting + clientsClaim — the new SW activates immediately
        //     instead of waiting for all tabs to close. Paired with the
        //     controllerchange reload in PwaUpdatePrompt, this guarantees
        //     every client runs the latest build after a deploy.
        //   cleanupOutdatedCaches — drops precache entries from previous
        //     builds so an orphaned index.html from an old SW can never
        //     reference chunk hashes that no longer exist on the server.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // Only precache built static assets + offline fallback
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024, // 3 MB — main bundle is ~2.2 MB
        globPatterns: ["**/*.{js,css,html,woff2,png,svg,ico}"],
        // Never intercept API calls, SSE, or auth endpoints
        // SPA: serve cached index.html for all navigation requests (except /api/)
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        // offline.html is precached as a fallback for the app shell to use when truly offline
        runtimeCaching: [
          {
            // Google Fonts stylesheets
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-stylesheets",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            // Google Fonts webfont files
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-webfonts",
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // API calls — never cache, always network
            urlPattern: /^\/api\/.*/i,
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
