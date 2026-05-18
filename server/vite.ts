import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import { nanoid } from "nanoid";

const viteLogger = createLogger();

/**
 * Simple server-side logger used across the app.
 * (server/index.ts expects this export)
 */
export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

/**
 * Vite dev middleware (development only).
 * IMPORTANT: SPA fallback is GET-only and must never intercept /api/* routes.
 */
export async function setupVite(app: Express, server: Server) {
  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: {
      ...(viteConfig.server ?? {}),
      middlewareMode: true,
      hmr: { server },
    },
    appType: "custom",
  });

  app.use(vite.middlewares);

  // SPA fallback — DEV (GET only, skip /api)
  app.get("*", async (req, res, next) => {
    if (req.path.startsWith("/api")) return next();

    try {
      const url = req.originalUrl;
      const clientIndex = path.resolve(import.meta.dirname, "..", "client", "index.html");

      let template = fs.readFileSync(clientIndex, "utf-8");
      template = await vite.transformIndexHtml(url, template);

      res.status(200).set({ "Content-Type": "text/html" }).end(template);
    } catch (e: any) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}

/**
 * Static file serving for production build.
 * Vite config builds client assets to: dist/public
 * In production, server runs from dist/index.js, so import.meta.dirname === dist
 *
 * 2026-04-26 cache-control hardening (stale-deploy fix):
 *
 *   The previous implementation called bare `express.static(distPath)` with no
 *   `setHeaders` callback. Express defaults to NO `Cache-Control` on static
 *   files, leaving every browser to apply heuristic caching. Modern browsers
 *   — Safari especially aggressively, but Chrome/Firefox/Edge under disk
 *   pressure too — can heuristically cache `index.html` for hours.
 *
 *   That meant after a Render deploy:
 *     1. Browser served stale `index.html` from HTTP cache.
 *     2. Stale HTML referenced asset hashes from the prior build, which
 *        Vite's `emptyOutDir: true` had purged from `dist/public`.
 *     3. The page loaded a mix of cached old chunks + 404'd new chunks →
 *        blank screen / React #310 errors.
 *
 *   Two stable rules close that window:
 *     - `/assets/*` (Vite's hashed bundle output): `public, max-age=31536000,
 *       immutable`. The filename hash IS the cache key — content can't change
 *       under the same name, so the longest-possible cache is correct.
 *     - Entrypoints that can change without their filename changing
 *       (`index.html`, `sw.js`, `workbox-*.js`, `manifest.webmanifest`):
 *       `no-cache, no-store, must-revalidate` so the browser always
 *       revalidates with the server. Adds at most one round-trip per visit
 *       (often a 304 via ETag); saves users from broken UI.
 *
 *   The PWA service-worker layer is unchanged — it still precaches and serves
 *   the SPA shell, but its update lifecycle finally has a chance to detect
 *   new builds because the SW file itself is no longer being served from a
 *   stale browser HTTP cache.
 */
export function serveStatic(app: Express) {
  const distPath = path.resolve(import.meta.dirname, "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}. Did you run \`npm run build\`?`,
    );
  }

  // Predicate for "this file's URL is a stable identity but its content can
  // change between deploys" — i.e. NOT a hashed bundle. Matches the file
  // path (not the request URL) so it works inside `setHeaders` callbacks.
  // 2026-04-30: explicitly enumerate registerSW.js / register-sw.js /
  // manifest.json. The pre-existing `endsWith("sw.js")` test happened to
  // match `registerSW.js` after lowercasing, but that was a coincidence —
  // a future filename change (e.g. `register.sw.js`, or the dropped
  // capital-S) would have silently lost the no-cache header.
  const isUpdateSensitive = (filePath: string): boolean => {
    const lower = filePath.toLowerCase();
    if (lower.endsWith("index.html")) return true;
    if (lower.endsWith("sw.js")) return true;
    if (lower.endsWith("service-worker.js")) return true;
    if (lower.endsWith("registersw.js")) return true;
    if (lower.endsWith("register-sw.js")) return true;
    if (lower.endsWith("manifest.webmanifest")) return true;
    if (lower.endsWith("manifest.json")) return true;
    if (lower.includes("workbox-")) return true;
    return false;
  };

  // (1) Hashed bundle assets — long-lived, immutable.
  // Vite emits content-hashed filenames into `/assets/`; the hash IS the
  // cache key. Caching forever is safe and reduces bandwidth meaningfully
  // on repeat visits.
  app.use(
    "/assets",
    express.static(path.resolve(distPath, "assets"), {
      immutable: true,
      maxAge: "1y",
      setHeaders: (res) => {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      },
    }),
  );

  // (2) Everything else under dist/public — entrypoints get explicit
  // `no-store`; static images / fonts at the root keep modest defaults.
  // 2026-05-01 RBAC + caching system fix: tightened from
  // `no-cache, no-store, must-revalidate` to bare `no-store`. `no-store`
  // is the strictest possible directive — the browser is forbidden
  // from storing the response in any cache, full stop. The previous
  // combo was functionally similar but harder to reason about; the
  // simpler form makes the intent unambiguous to reviewers and to
  // intermediate caches (CDN / corporate proxy).
  //
  // 2026-05-18 CDN fix: Surrogate-Control is the edge-cache equivalent of
  // Cache-Control. Cloudflare and other CDNs sometimes ignore
  // Cache-Control: no-store for HTML responses and serve stale shells.
  // Setting Surrogate-Control: no-store instructs the edge layer to never
  // store the response regardless of its Cache-Control interpretation.
  app.use(
    express.static(distPath, {
      setHeaders: (res, filePath) => {
        if (isUpdateSensitive(filePath)) {
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("Surrogate-Control", "no-store");
        }
      },
    }),
  );

  // (3) SPA fallback — every navigation that lands here renders index.html.
  // Both Cache-Control and Surrogate-Control must carry no-store so neither
  // the browser nor any edge cache can serve a stale app shell.
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Surrogate-Control", "no-store");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
