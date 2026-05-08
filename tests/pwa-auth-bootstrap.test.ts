/**
 * PWA + auth bootstrap — source-pin contract tests (2026-05-08 RALPH).
 *
 * Pins the Option-C fix:
 *
 *   1. /api/* requests are NOT registered with Workbox. The browser
 *      handles them directly. NavigationRoute keeps its `[/^\/api\//]`
 *      denylist so navigation handling can't accidentally claim API
 *      requests either.
 *   2. `initCSRF()` retries with 1s / 3s / 7s backoff and a
 *      per-attempt 12s AbortController timeout (~46s worst-case).
 *      Failures throw a typed `CsrfBootstrapError` with the last
 *      cause attached.
 *   3. The login UI catches `CsrfBootstrapError` and renders an
 *      actionable recovery banner with a "Reset app cache" button
 *      that unregisters every service-worker registration and
 *      reloads the page.
 *
 * Source-pin tests because the contract is decided at file shape —
 * no jsdom/RTL needed to lock the architectural decision in place.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  CsrfBootstrapError,
  isCsrfBootstrapError,
} from "../client/src/lib/queryClient";

const ROOT = resolve(__dirname, "..");
const path = (p: string) => resolve(ROOT, p);

const SW_PATH = path("client/src/sw.ts");
const QUERY_CLIENT_PATH = path("client/src/lib/queryClient.ts");
const LOGIN_PATH = path("client/src/pages/Login.tsx");

function read(p: string): string {
  return readFileSync(p, "utf-8");
}

// Strip block comments and single-line line comments using a tiny
// state machine that respects string boundaries. A naive regex
// stripper mis-handles two important cases in this codebase:
//   1. `//` inside URL strings (e.g. `"https://fonts.googleapis.com"`)
//      gets eaten through to end-of-line.
//   2. `/*` inside line comments (e.g. `// /tech/* path`) is treated
//      as a block-comment OPEN and consumes everything to the next
//      `*/` somewhere later in the file.
// The walker below tracks string state and comment state explicitly
// so neither false-positive can fire.
function stripCommentsSafe(src: string): string {
  const out: string[] = [];
  let i = 0;
  const n = src.length;
  let inString: '"' | "'" | "`" | null = null;
  let inLine = false;
  let inBlock = false;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (inLine) {
      if (c === "\n") {
        inLine = false;
        out.push(c);
      }
      i++;
      continue;
    }
    if (inBlock) {
      if (c === "*" && c2 === "/") {
        inBlock = false;
        i += 2;
      } else {
        i++;
      }
      continue;
    }
    if (inString) {
      out.push(c);
      if (c === "\\") {
        // Pass through the escaped char too.
        if (c2 !== undefined) {
          out.push(c2);
          i += 2;
          continue;
        }
      } else if (c === inString) {
        inString = null;
      }
      i++;
      continue;
    }
    // Not in a string or comment: look for openers.
    if (c === "/" && c2 === "/") {
      inLine = true;
      i += 2;
      continue;
    }
    if (c === "/" && c2 === "*") {
      inBlock = true;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inString = c as '"' | "'" | "`";
      out.push(c);
      i++;
      continue;
    }
    out.push(c);
    i++;
  }
  return out.join("");
}

// ─── 1. Service worker — /api/* is NOT routed by Workbox ───────────

describe("Service worker — /api/* bypasses Workbox", () => {
  const src = read(SW_PATH);
  const codeOnly = stripCommentsSafe(src);

  it("does NOT import NetworkOnly from workbox-strategies", () => {
    // Removing the API NetworkOnly route means the strategy import
    // is dead. Lock the absence so a future refactor can't quietly
    // re-introduce it.
    expect(codeOnly).not.toMatch(/NetworkOnly\b/);
  });

  it("does NOT register a route matching pathname.startsWith('/api/')", () => {
    // The retired registration was:
    //   registerRoute(({ url }) => url.pathname.startsWith("/api/"), new NetworkOnly());
    // After the 2026-05-08 fix, the SW's fetch listener never calls
    // respondWith() for /api/* requests — the browser handles them
    // directly. Confirms there's no `pathname.startsWith("/api/")`
    // route matcher anywhere in the SW source.
    expect(codeOnly).not.toMatch(
      /url\.pathname\.startsWith\(\s*["']\/api\/["']\s*\)/,
    );
  });

  it("does NOT register a default handler that could swallow API requests", () => {
    // setDefaultHandler would re-introduce SW interception of API
    // requests by accident. Pin the absence.
    expect(codeOnly).not.toMatch(/setDefaultHandler\(/);
    expect(codeOnly).not.toMatch(/setCatchHandler\(/);
  });

  it("NavigationRoute STILL denylists /api/* (defense in depth)", () => {
    // Even though the API route is gone, navigation-mode requests to
    // /api/ paths must NEVER fall into the SPA shell handler. The
    // denylist prevents that. Match the load-bearing fragments
    // separately to avoid regex-literal escape gymnastics.
    expect(codeOnly).toMatch(/new NavigationRoute\(/);
    expect(codeOnly).toMatch(/denylist:\s*\[\s*\/\^/);
    // The denylist regex literal contains the API path. Cap the
    // pattern at `\\/api` (escaped slash + api) so the match is
    // unambiguous about what's being excluded.
    expect(codeOnly).toMatch(/denylist:\s*\[\s*\/\^\\\/api/);
  });

  it("preserves precache + cleanupOutdatedCaches + skipWaiting + clientsClaim", () => {
    // The /api/* removal must not weaken the static-asset lifecycle.
    // Pin the four canonical activate-time invariants.
    expect(codeOnly).toMatch(/precacheAndRoute\(/);
    expect(codeOnly).toMatch(/cleanupOutdatedCaches\(/);
    expect(codeOnly).toMatch(/self\.skipWaiting\(\)/);
    expect(codeOnly).toMatch(/self\.clients\.claim\(\)/);
  });

  it("preserves the Google Fonts CacheFirst routes", () => {
    // Cross-origin font caching is a separate, unrelated route that
    // must survive the API-route removal. Run against `src` (not
    // `codeOnly`) because the URL string literal contains `//`
    // which would confuse a naive line-comment stripper.
    expect(src).toMatch(/fonts\.googleapis\.com/);
    expect(src).toMatch(/fonts\.gstatic\.com/);
  });

  it("documents WHY /api/* is not routed (so a future refactor doesn't 'fix' it)", () => {
    // The full source (including comments) MUST contain the
    // architectural rationale so a future maintainer understands why
    // this is intentional and not an oversight. The "respondWith ...
    // no-response" phrase is split across comment lines, so use a
    // multi-line-tolerant matcher.
    expect(src).toMatch(/intentionally NOT registered with Workbox/i);
    expect(src).toMatch(/respondWith[\s\S]+?no-response/i);
  });
});

// ─── 2. CSRF bootstrap — retry + typed failure ─────────────────────

describe("initCSRF — retry + backoff + typed bootstrap error", () => {
  const src = read(QUERY_CLIENT_PATH);
  const codeOnly = stripCommentsSafe(src);

  it("declares a 3-attempt retry constant", () => {
    expect(codeOnly).toMatch(/CSRF_RETRY_DELAYS_MS\s*=\s*\[\s*1000,\s*3000,\s*7000/);
    expect(codeOnly).toMatch(
      /CSRF_RETRY_MAX_ATTEMPTS\s*=\s*CSRF_RETRY_DELAYS_MS\.length/,
    );
  });

  it("declares a per-attempt timeout sufficient for Render cold-starts", () => {
    // 12 seconds per attempt × 3 attempts + 1+3+7 backoff ≈ 47s
    // worst-case — comfortably above Render free-tier cold-start.
    expect(codeOnly).toMatch(/CSRF_PER_ATTEMPT_TIMEOUT_MS\s*=\s*12000/);
  });

  it("the per-attempt fetch uses credentials: 'include' AND cache: 'no-store'", () => {
    expect(codeOnly).toMatch(/credentials:\s*["']include["']/);
    expect(codeOnly).toMatch(/cache:\s*["']no-store["']/);
  });

  it("the per-attempt fetch cache-busts via ?t=Date.now()", () => {
    expect(codeOnly).toMatch(/`\/api\/csrf-token\?t=\$\{Date\.now\(\)\}`/);
  });

  it("the per-attempt fetch is wrapped in an AbortController timeout", () => {
    expect(codeOnly).toMatch(/new AbortController\(\)/);
    expect(codeOnly).toMatch(
      /setTimeout\([\s\S]*?controller\.abort\(\)[\s\S]*?CSRF_PER_ATTEMPT_TIMEOUT_MS/,
    );
  });

  it("initCSRF uses a sleep-based retry loop (no recursion)", () => {
    expect(codeOnly).toMatch(/for\s*\(\s*let\s+attempt\s*=\s*1;\s*attempt\s*<=\s*CSRF_RETRY_MAX_ATTEMPTS/);
    expect(codeOnly).toMatch(/await sleep\(\s*delay\s*\)/);
  });

  it("preserves the in-flight de-dup guard so concurrent callers piggyback", () => {
    expect(codeOnly).toMatch(/if\s*\(\s*csrfInitPromise\s*\)\s*\{\s*return\s+csrfInitPromise/);
  });

  it("clears the in-memory token BEFORE awaiting the fresh fetch", () => {
    // The race-condition protection: any concurrent getCSRFToken()
    // sees null and awaits the same fresh fetch.
    expect(codeOnly).toMatch(/csrfToken\s*=\s*null;[\s\S]+?csrfInitPromise/);
  });

  it("exports CsrfBootstrapError as a named class with attempts + cause", () => {
    expect(codeOnly).toMatch(/export class CsrfBootstrapError extends Error/);
    expect(codeOnly).toMatch(/public readonly attempts:\s*number/);
    expect(codeOnly).toMatch(/public readonly cause:\s*unknown/);
  });

  it("exports isCsrfBootstrapError as a type guard", () => {
    expect(codeOnly).toMatch(
      /export function isCsrfBootstrapError\(\s*error:\s*unknown,?\s*\):\s*error is CsrfBootstrapError/,
    );
  });

  it("throws CsrfBootstrapError with the configured attempt count + last cause", () => {
    expect(codeOnly).toMatch(
      /throw new CsrfBootstrapError\([\s\S]+?CSRF_RETRY_MAX_ATTEMPTS,\s*lastError/,
    );
  });
});

describe("CsrfBootstrapError — runtime shape", () => {
  it("is constructable with message + attempts + cause", () => {
    const cause = new Error("network");
    const e = new CsrfBootstrapError("nope", 3, cause);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("CsrfBootstrapError");
    expect(e.message).toBe("nope");
    expect(e.attempts).toBe(3);
    expect(e.cause).toBe(cause);
  });

  it("isCsrfBootstrapError narrows correctly", () => {
    expect(isCsrfBootstrapError(new CsrfBootstrapError("x", 1, null))).toBe(true);
    expect(isCsrfBootstrapError(new Error("x"))).toBe(false);
    expect(isCsrfBootstrapError(null)).toBe(false);
    expect(isCsrfBootstrapError(undefined)).toBe(false);
    expect(isCsrfBootstrapError("string")).toBe(false);
  });
});

// ─── 3. Login UI — recovery affordance after exhausted retries ─────

describe("Login page — CSRF bootstrap recovery affordance", () => {
  const src = read(LOGIN_PATH);
  const codeOnly = stripCommentsSafe(src);

  it("imports the canonical isCsrfBootstrapError type guard", () => {
    expect(codeOnly).toMatch(
      /import\s*\{\s*isCsrfBootstrapError\s*\}\s*from\s*["']@\/lib\/queryClient["']/,
    );
  });

  it("the error catch branches on isCsrfBootstrapError(error)", () => {
    expect(codeOnly).toMatch(/if\s*\(\s*isCsrfBootstrapError\(\s*error\s*\)\s*\)/);
  });

  it("declares csrfRecovery state that the catch block flips on", () => {
    expect(codeOnly).toMatch(
      /const\s*\[\s*csrfRecovery\s*,\s*setCsrfRecovery\s*\]\s*=\s*useState\(\s*false\s*\)/,
    );
    expect(codeOnly).toMatch(/setCsrfRecovery\(\s*true\s*\)/);
  });

  it("renders the recovery banner with the canonical test ids", () => {
    expect(src).toMatch(/data-testid="login-csrf-recovery"/);
    expect(src).toMatch(/data-testid="login-csrf-recovery-retry"/);
    expect(src).toMatch(/data-testid="login-csrf-recovery-reset"/);
  });

  it("the banner copy tells users the actual cause and gives recovery options", () => {
    // "secure session" may be split across JSX lines by the
    // formatter, so match across whitespace.
    expect(src).toMatch(/[Cc]ould not (reach|refresh)/);
    expect(src).toMatch(/secure[\s\S]+?session/i);
    expect(src).toMatch(/Reset app cache/);
  });

  it("the banner is a role='alert' so screen readers announce it immediately", () => {
    expect(src).toMatch(/role="alert"/);
  });

  it("declares resetAppCacheAndReload helper with the canonical SW unregister flow", () => {
    expect(codeOnly).toMatch(
      /async function resetAppCacheAndReload\(\)\s*:\s*Promise<void>/,
    );
    expect(codeOnly).toMatch(/navigator\.serviceWorker\.getRegistrations\(\)/);
    expect(codeOnly).toMatch(/r\.unregister\(\)/);
    expect(codeOnly).toMatch(/window\.location\.reload\(\)/);
  });

  it("falls back to a plain reload when serviceWorker is unavailable", () => {
    // The "serviceWorker" in navigator gate plus the always-trailing
    // window.location.reload() means a non-SW environment still
    // gets recovered via reload alone.
    expect(codeOnly).toMatch(/"serviceWorker"\s*in\s*navigator/);
  });

  it("does NOT auto-call resetAppCacheAndReload (only fires from a button click)", () => {
    // Critical invariant: we never silently unregister the SW.
    // The user must click the button. Pin that the helper is only
    // invoked from the click handler.
    const useEffectIdx = codeOnly.indexOf("useEffect");
    if (useEffectIdx > -1) {
      const slice = codeOnly.slice(useEffectIdx);
      expect(slice).not.toMatch(/resetAppCacheAndReload\(\)/);
    }
  });

  it("the Reset app cache button shows a 'Resetting…' label while the call is in flight", () => {
    expect(codeOnly).toMatch(/resettingCache\s*\?\s*["']Resetting…["']\s*:\s*["']Reset app cache["']/);
  });
});

// ─── 4. Login UI — non-CSRF errors still surface as toasts ─────────

describe("Login page — non-CSRF errors keep the existing toast path", () => {
  const src = read(LOGIN_PATH);
  const codeOnly = stripCommentsSafe(src);

  it("the catch block falls through to toast() when error is NOT CsrfBootstrapError", () => {
    expect(codeOnly).toMatch(
      /if\s*\(\s*isCsrfBootstrapError\(\s*error\s*\)\s*\)\s*\{[\s\S]+?\}\s*else\s*\{[\s\S]+?toast\(/,
    );
  });

  it("the toast still uses the 'Login failed' / Invalid email or password copy", () => {
    expect(codeOnly).toMatch(/title:\s*["']Login failed["']/);
    expect(codeOnly).toMatch(/Invalid email or password/);
  });
});
