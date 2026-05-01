import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { execSync } from "node:child_process";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { VitePWA } from "vite-plugin-pwa";
import { BRAND } from "./shared/branding";

/**
 * 2026-04-30 stale-deploy fix (Balanced): emit a build identifier so
 * deploy propagation can be verified by visual inspection (DevTools →
 * Elements → <head>) and so the runtime reload guard in
 * `PwaUpdatePrompt.tsx` can compare "the build I'm running" against
 * "the build I last reloaded for". Prefers a short git SHA, falls back
 * to a timestamp-based stamp on machines without git in PATH.
 */
function resolveBuildId(): string {
  try {
    const sha = execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    if (sha) return sha;
  } catch {
    // git not available or not a repo — fall through
  }
  return `build-${Date.now()}`;
}

/**
 * Vite HTML plugin — injects a `<meta name="build-id">` tag and a
 * `window.__SYNTRARO_BUILD__` global into every emitted index.html.
 * The global is set BEFORE the React entry script so the value is
 * readable by the very first line of app code (matters for the SW
 * reload guard, which can fire on initial controllerchange before
 * React mounts). The meta tag is for human/DevTools verification.
 */
function syntraroBuildIdPlugin(): Plugin {
  const buildId = resolveBuildId();
  return {
    name: "syntraro-build-id",
    transformIndexHtml(html) {
      const injection =
        `    <meta name="build-id" content="${buildId}" />\n` +
        `    <script>window.__SYNTRARO_BUILD__=${JSON.stringify(buildId)};</script>\n` +
        `  </head>`;
      return html.replace("</head>", injection);
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    syntraroBuildIdPlugin(),
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
      // 2026-04-21 Phase 1 push notifications: flipped from the default
      // `generateSW` strategy to `injectManifest` with a custom source at
      // `client/src/sw.ts`. The custom SW preserves the previous Workbox
      // precache + runtime-cache behavior AND adds `push` / `notificationclick`
      // listeners. Nothing about the update-prompt flow changes — the same
      // `virtual:pwa-register` contract (used by PwaUpdatePrompt.tsx) still
      // applies.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      includeAssets: ["favicon.png", "apple-touch-icon.png"],
      manifest: {
        // 2026-05-01 brand pivot — sourced from shared/branding.ts.
        name: BRAND.pwa.name,
        short_name: BRAND.pwa.shortName,
        description: BRAND.pwa.description,
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
      injectManifest: {
        // Only precache built static assets.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024, // 3 MB — main bundle is ~2.2 MB
        globPatterns: ["**/*.{js,css,html,woff2,png,svg,ico}"],
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
