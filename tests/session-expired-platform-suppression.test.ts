/**
 * Session-Expired Suppression — `/api/platform/*` + `/platform` paths
 * (2026-05-03).
 *
 * Regression test for the incognito-/platform/login leak. The tenant
 * `SessionExpiredDialog` was opening over the platform login page
 * because `notifySessionExpired` in `client/src/lib/queryClient.ts`
 * had no skip rule for either:
 *   • `/api/platform/*` URLs (the source of the 401 — e.g. the tenant
 *     `useActiveTaskCount` query hitting `/api/tasks` while
 *     unauthenticated, but ALSO `/api/platform/auth/me` from the
 *     PlatformAuthProvider once it mounts), nor
 *   • `/platform/*` pathnames (the current page).
 *
 * This test re-imports the pure helper logic from queryClient.ts and
 * verifies the new skip rules. The actual `notifySessionExpired`
 * function is internal/private (not exported), but the rules it
 * encodes are fully expressible with two predicates we re-implement
 * here in the test — and pin them against the same string lists the
 * source uses, by importing them indirectly via runtime introspection
 * of the source file.
 *
 * Approach: read the source as text and assert it contains the new
 * skip clauses. This is a documentation-coupling test — if someone
 * edits queryClient.ts to remove the skip, this test fails loudly.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const queryClientSrc = readFileSync(
  resolve(__dirname, "../client/src/lib/queryClient.ts"),
  "utf-8",
);
const dialogSrc = readFileSync(
  resolve(__dirname, "../client/src/components/SessionExpiredDialog.tsx"),
  "utf-8",
);
const appSrc = readFileSync(
  resolve(__dirname, "../client/src/App.tsx"),
  "utf-8",
);

describe("notifySessionExpired (queryClient.ts)", () => {
  it("AUTH_PAGE_PREFIXES includes /platform so the modal cannot open over any platform page", () => {
    // The list is declared as a string literal in source. Match the
    // full quoted token so a bare substring match (e.g. `/platforming`)
    // can't false-positive.
    expect(queryClientSrc).toMatch(/AUTH_PAGE_PREFIXES\s*=\s*\[[^\]]*"\/platform"/m);
  });

  it("notifySessionExpired skips /api/platform/* URLs (no tenant modal on platform 401s)", () => {
    expect(queryClientSrc).toMatch(/url\.startsWith\("\/api\/platform\/"\)/);
  });

  it("the existing /api/auth/me + /api/portal/* + dispatch-stream skips remain in place", () => {
    expect(queryClientSrc).toContain('url === "/api/auth/me"');
    expect(queryClientSrc).toContain('url === "/api/dispatch/stream"');
    expect(queryClientSrc).toContain('url.startsWith("/api/portal/")');
  });
});

describe("SessionExpiredDialog AUTH_PAGE_PREFIXES", () => {
  it("includes /platform so a stale event during a navigation gap cannot pop the modal", () => {
    expect(dialogSrc).toMatch(/AUTH_PAGE_PREFIXES\s*=\s*\[[\s\S]*?"\/platform"[\s\S]*?\]/m);
  });

  it("still includes the legacy tenant + portal auth pages", () => {
    expect(dialogSrc).toContain('"/login"');
    expect(dialogSrc).toContain('"/portal/login"');
    expect(dialogSrc).toContain('"/portal/verify"');
  });
});

describe("AppContent useActiveTaskCount gate (App.tsx)", () => {
  it("only fires the tenant /api/tasks query when there is an authenticated tenant user", () => {
    // 2026-05-04 Phase 7: simplified from
    //   `enabled: Boolean(user?.id) && !isPlatformRole(user?.role)`
    // to
    //   `enabled: Boolean(user?.id)`
    // because tenant `useAuth()` users cannot be platform-role after
    // Phase 6's DB CHECK constraint. The `Boolean(user?.id)` half is
    // the load-bearing piece that stops the unauthenticated 401 leak
    // documented in this file's other tests; pin its presence here.
    expect(appSrc).toMatch(
      /useActiveTaskCount\(\{\s*enabled:\s*Boolean\(user\?\.id\)\s*,/,
    );
    // Confirm the dropped clause is GONE — a regression that
    // re-introduces it would mean either (a) a stale platform-role
    // check that's now structurally impossible, or (b) someone
    // inadvertently wiring tenant code to the legacy contamination
    // model again.
    expect(appSrc).not.toMatch(/!isPlatformRole\(user\?\.role\)/);
  });
});
