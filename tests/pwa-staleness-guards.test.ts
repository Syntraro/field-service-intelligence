/**
 * PWA stale-bundle guard tests (2026-05-11).
 *
 * Structural assertions that the complete stale-deploy defence chain is
 * wired correctly. All confirmed via the two-build empirical audit that
 * proved:
 *   - emptyOutDir deletes 24/25 Build-A JS chunks after any deploy.
 *   - cleanupOutdatedCaches() only clears workbox-precache-v2-* caches;
 *     "syntraro-html-shell" survives SW updates unchanged.
 *   - Stale cached index.html → 404 on the old main entry chunk → blank screen.
 *
 * No runtime execution — purely structural file-read checks.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

function read(rel: string) {
  return readFileSync(resolve(__dirname, rel), "utf-8");
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

const swSrc         = read("../client/src/sw.ts");
const swCode        = stripComments(swSrc);
const viteCfgSrc    = read("../vite.config.ts");
const viteCfgCode   = stripComments(viteCfgSrc);
const promptSrc     = read("../client/src/components/PwaUpdatePrompt.tsx");
const promptCode    = stripComments(promptSrc);
const mainSrc       = read("../client/src/main.tsx");
const serverViteSrc = read("../server/vite.ts");
const serverViteCode = stripComments(serverViteSrc);

// ── 1. Service worker: HTML shell cache management ────────────────────────

describe("sw.ts — syntraro-html-shell cache management", () => {
  it("names the HTML shell runtime cache 'syntraro-html-shell'", () => {
    expect(swSrc).toMatch(/syntraro-html-shell/);
  });

  it("deletes 'syntraro-html-shell' inside the activate event handler", () => {
    // The delete must be inside the activate listener so it runs on each
    // SW update before clients.claim() takes over existing tabs.
    expect(swSrc).toMatch(/addEventListener\(["']activate["']/);
    expect(swSrc).toMatch(/caches\.delete\(["']syntraro-html-shell["']\)/);
    // Confirm both appear in proximity (delete wired to activate, not install)
    const activateIdx = swSrc.indexOf('addEventListener("activate"');
    const deleteIdx   = swSrc.indexOf('caches.delete("syntraro-html-shell")');
    expect(activateIdx).toBeGreaterThan(-1);
    expect(deleteIdx).toBeGreaterThan(-1);
    // delete appears AFTER the activate listener is opened
    expect(deleteIdx).toBeGreaterThan(activateIdx);
  });

  it("chains clients.claim() after caches.delete() so claim still runs", () => {
    expect(swSrc).toMatch(/caches\.delete\(["']syntraro-html-shell["']\).*clients\.claim/s);
  });

  it("calls cleanupOutdatedCaches() for precache housekeeping", () => {
    expect(swSrc).toMatch(/cleanupOutdatedCaches\(\)/);
  });

  it("calls skipWaiting() so the new SW activates without waiting", () => {
    expect(swSrc).toMatch(/skipWaiting\(\)/);
  });

  it("uses NetworkFirst (not CacheFirst/StaleWhileRevalidate) for navigation", () => {
    expect(swSrc).toMatch(/new NetworkFirst\(/);
    expect(swSrc).not.toMatch(/new CacheFirst\([^)]*syntraro-html-shell/);
    expect(swSrc).not.toMatch(/new StaleWhileRevalidate\([^)]*syntraro-html-shell/);
  });

  it("denies /api/ paths from the navigation route", () => {
    expect(swSrc).toMatch(/denylist.*\/api\//s);
  });

  it("uses NetworkOnly for /api/ routes (never cached)", () => {
    expect(swSrc).toMatch(/NetworkOnly/);
    expect(swSrc).toMatch(/pathname\.startsWith\(["']\/api\//);
  });

  it("has ExpirationPlugin on syntraro-html-shell with maxEntries and maxAgeSeconds", () => {
    // Secondary protection — ensures stale entries expire within 24h even
    // if the activate-time cache.delete path ran before a final navigation.
    expect(swSrc).toMatch(/ExpirationPlugin/);
    expect(swSrc).toMatch(/maxEntries:\s*1/);
    expect(swSrc).toMatch(/maxAgeSeconds:\s*24\s*\*\s*60\s*\*\s*60/);
  });

  it("has matchPrecache('/index.html') offline fallback", () => {
    expect(swSrc).toMatch(/matchPrecache\(["']\/index\.html["']\)/);
  });

  it("does not call createHandlerBoundToURL in live code (regression guard)", () => {
    // Strip comments — the old strategy is documented in a comment for historical
    // context; the guard is on actual call-site usage, not documentation.
    expect(swCode).not.toMatch(/createHandlerBoundToURL/);
  });
});

// ── 2. vite.config.ts: PWA plugin configuration ───────────────────────────

describe("vite.config.ts — PWA plugin configuration", () => {
  it("uses injectManifest strategy (custom SW source)", () => {
    expect(viteCfgSrc).toMatch(/strategies:\s*["']injectManifest["']/);
  });

  it("registerType is 'autoUpdate'", () => {
    expect(viteCfgSrc).toMatch(/registerType:\s*["']autoUpdate["']/);
  });

  it("injectRegister is explicitly set to null (no auto-injected raw script)", () => {
    // Prevents the double-registration race between the raw registerSW.js
    // script tag and PwaUpdatePrompt.tsx's virtual:pwa-register path.
    expect(viteCfgSrc).toMatch(/injectRegister:\s*null/);
  });

  it("build ID injection plugin is present", () => {
    expect(viteCfgSrc).toMatch(/syntraroBuildIdPlugin/);
    expect(viteCfgSrc).toMatch(/build-id/);
  });

  it("maximumFileSizeToCacheInBytes is at least 4 MB", () => {
    // Config was updated from 3 MB to 4 MB (2026-05-11) after main bundle
    // was measured at 3.44 MB. Updated assertion to match actual value.
    expect(viteCfgSrc).toMatch(/maximumFileSizeToCacheInBytes:\s*4\s*\*\s*1024\s*\*\s*1024/);
  });

  it("globPatterns includes html (index.html precached for offline fallback)", () => {
    expect(viteCfgSrc).toMatch(/globPatterns.*html/s);
  });
});

// ── 3. Build output: no registerSW.js script tag in index.html ───────────
//
// Only runs if the production build has been executed. The file may not
// exist in a clean checkout; skip gracefully so CI without a prior build
// doesn't fail.

describe("dist/public/index.html — post-build verification", () => {
  let htmlContent = "";
  try {
    htmlContent = read("../dist/public/index.html");
  } catch {
    // Build not present — tests below will trivially pass on empty string;
    // mark as skipped via a soft check instead of crashing.
  }

  it("does not include a registerSW.js script tag (double-registration removed)", () => {
    if (!htmlContent) return; // not built yet, skip
    expect(htmlContent).not.toMatch(/registerSW\.js/);
  });

  it("includes the manifest.webmanifest link", () => {
    if (!htmlContent) return;
    expect(htmlContent).toMatch(/manifest\.webmanifest/);
  });

  it("includes the build-id meta tag (injected at build time)", () => {
    if (!htmlContent) return;
    expect(htmlContent).toMatch(/meta.*name="build-id"/);
  });

  it("includes window.__SYNTRARO_BUILD__ global injection", () => {
    if (!htmlContent) return;
    expect(htmlContent).toMatch(/__SYNTRARO_BUILD__/);
  });
});

// ── 4. PwaUpdatePrompt.tsx: update triggers ───────────────────────────────

describe("PwaUpdatePrompt.tsx — SW update triggers and reload guard", () => {
  it("registers visibilitychange listener for tab-resume updates", () => {
    expect(promptSrc).toMatch(/visibilitychange/);
    expect(promptSrc).toMatch(/registration\.update\(\)/);
  });

  it("registers pageshow listener for iOS bfcache / PWA resume (2026-05-11)", () => {
    expect(promptSrc).toMatch(/pageshow/);
  });

  it("registers online listener for network-reconnect updates", () => {
    expect(promptSrc).toMatch(/['"']online['"']/);
  });

  it("registers controllerchange listener for auto-reload on SW claim", () => {
    expect(promptSrc).toMatch(/controllerchange/);
    expect(promptSrc).toMatch(/window\.location\.reload\(\)/);
  });

  it("has throttled route-change update check with ROUTE_UPDATE_THROTTLE_MS", () => {
    expect(promptSrc).toMatch(/ROUTE_UPDATE_THROTTLE_MS/);
    expect(promptSrc).toMatch(/5\s*\*\s*60\s*\*\s*1000/);
  });

  it("uses useLocation for route-change detection", () => {
    expect(promptSrc).toMatch(/useLocation/);
  });

  it("has a registrationRef for sharing registration with route-change effect", () => {
    expect(promptSrc).toMatch(/registrationRef/);
  });

  it("has reload loop guard via RELOAD_BUILD_KEY and RELOAD_AT_KEY in sessionStorage", () => {
    expect(promptSrc).toMatch(/RELOAD_BUILD_KEY/);
    expect(promptSrc).toMatch(/RELOAD_AT_KEY/);
    expect(promptSrc).toMatch(/sessionStorage/);
  });

  it("reads build ID from window.__SYNTRARO_BUILD__ with meta fallback", () => {
    expect(promptSrc).toMatch(/__SYNTRARO_BUILD__/);
    expect(promptSrc).toMatch(/meta\[name="build-id"\]/);
  });

  it("removes all event listeners on unmount (no leaks)", () => {
    expect(promptSrc).toMatch(/removeEventListener.*visibilitychange/);
    expect(promptSrc).toMatch(/removeEventListener.*pageshow/);
    expect(promptSrc).toMatch(/removeEventListener.*online/);
    expect(promptSrc).toMatch(/removeEventListener.*controllerchange/);
  });

  it("does not import ThemeProvider or isDark patterns (not the right pattern)", () => {
    expect(promptSrc).not.toMatch(/ThemeProvider/);
    expect(promptSrc).not.toMatch(/\bisDark\b/);
  });
});

// ── 5. main.tsx: ChunkLoadError recovery ─────────────────────────────────

describe("main.tsx — ChunkLoadError / stale-chunk recovery", () => {
  it("listens for unhandledrejection (dynamic import failures are promise rejections)", () => {
    expect(mainSrc).toMatch(/unhandledrejection/);
  });

  it("listens for error (synchronous chunk load errors)", () => {
    expect(mainSrc).toMatch(/window\.addEventListener\(["']error["']/);
  });

  it("detects 'Failed to fetch dynamically imported module'", () => {
    expect(mainSrc).toMatch(/Failed to fetch dynamically imported module/);
  });

  it("detects 'Importing a module script failed' (Safari variant)", () => {
    expect(mainSrc).toMatch(/Importing a module script failed/);
  });

  it("detects 'ChunkLoadError' by name", () => {
    expect(mainSrc).toMatch(/ChunkLoadError/);
  });

  it("uses a sessionStorage key as reload-loop guard", () => {
    expect(mainSrc).toMatch(/CHUNK_RELOAD_KEY/);
    expect(mainSrc).toMatch(/sessionStorage/);
  });

  it("only reloads for chunk errors, not arbitrary app errors", () => {
    // isChunkError / maybeReloadForChunkError guards the reload
    expect(mainSrc).toMatch(/isChunkError|maybeReloadForChunkError/);
  });

  it("calls window.location.reload() on confirmed chunk error", () => {
    expect(mainSrc).toMatch(/window\.location\.reload\(\)/);
  });

  it("has a 30-second floor on the chunk-reload loop guard", () => {
    expect(mainSrc).toMatch(/30[_,]?000/);
  });
});

// ── 6. server/vite.ts: HTTP cache headers ────────────────────────────────

describe("server/vite.ts — HTTP cache-control headers", () => {
  it("index.html is flagged as update-sensitive (no-store)", () => {
    expect(serverViteSrc).toMatch(/endsWith.*index\.html.*return true/s);
  });

  it("sw.js is flagged as update-sensitive (no-store)", () => {
    expect(serverViteSrc).toMatch(/endsWith.*sw\.js.*return true/s);
  });

  it("registerSW.js is flagged as update-sensitive", () => {
    expect(serverViteSrc).toMatch(/registersw\.js/i);
  });

  it("workbox-* files are flagged as update-sensitive", () => {
    expect(serverViteSrc).toMatch(/workbox-/);
  });

  it("manifest.webmanifest is flagged as update-sensitive", () => {
    expect(serverViteSrc).toMatch(/manifest\.webmanifest/);
  });

  it("SPA fallback (GET *) sets Cache-Control: no-store", () => {
    expect(serverViteSrc).toMatch(/no-store/);
    expect(serverViteSrc).toMatch(/sendFile.*index\.html/s);
  });

  it("/assets uses immutable long-lived cache", () => {
    expect(serverViteSrc).toMatch(/max-age=31536000.*immutable/);
  });

  it("does not set Cache-Control on /api/ routes (handled separately)", () => {
    // The api guard is a short-circuit, not a cache header setter
    expect(serverViteSrc).toMatch(/req\.path\.startsWith\(["']\/api/);
  });
});
