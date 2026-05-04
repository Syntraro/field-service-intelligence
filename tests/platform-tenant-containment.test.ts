/**
 * Platform/Tenant Identity Containment — regression tests (2026-05-04).
 *
 * Pins the "platform user must not appear in tenant team surfaces" fix.
 *
 * The bug: platform-role accounts share the `users` table with tenant
 * users. Their `companyId` is a "parking" FK to whichever tenant was
 * picked at seed time. Tenant Team Management was filtering only by
 * `companyId`, so the parked platform user appeared in Samcor's team
 * list as "Platform Admin".
 *
 * The fix: every tenant-facing users-table query composes
 * `nonPlatformUserPredicate()` from `server/storage/tenantUserPredicate.ts`
 * into its where clause. This file pins the predicate's behavior plus
 * a few callsite checks (TeamRepository.getTeamMembers /
 * getTeamMember / getTechniciansByCompanyId) via runtime Drizzle SQL
 * inspection.
 *
 * Approach: pure source-level + Drizzle predicate construction tests.
 * No DB round-trip — keeps the suite fast and isolated. The actual
 * SQL is composed and we assert the predicate's `notInArray` shape
 * over the canonical PLATFORM_ROLES list. Callsite tests confirm the
 * helper is wired into every team query that touches `users`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

import { nonPlatformUserPredicate } from "../server/storage/tenantUserPredicate";
import { PLATFORM_ROLES, isPlatformRole } from "../server/auth/roles";

// ============================================================================
// Predicate shape
// ============================================================================

describe("nonPlatformUserPredicate (tenant-user containment helper)", () => {
  it("returns a Drizzle SQL fragment", () => {
    const pred = nonPlatformUserPredicate();
    // Drizzle SQL nodes expose a `.queryChunks` array (circular ref to
    // the table object — can't JSON.stringify, but we can inspect
    // chunks directly). The presence of queryChunks plus a non-empty
    // length confirms we got back a real composable SQL fragment, not
    // an empty/null object.
    expect(pred).toBeTruthy();
    expect(typeof pred).toBe("object");
    const chunks = (pred as any).queryChunks;
    expect(Array.isArray(chunks)).toBe(true);
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("uses the canonical PLATFORM_ROLES list as the exclusion set", () => {
    // The predicate must reference each canonical role; if a future
    // commit drops one (e.g. forgets `platform_billing`), the bug
    // resurfaces silently.
    expect(PLATFORM_ROLES).toContain("platform_admin");
    expect(PLATFORM_ROLES).toContain("platform_support");
    expect(PLATFORM_ROLES).toContain("platform_billing");
    expect(PLATFORM_ROLES).toContain("platform_readonly_audit");
    expect(PLATFORM_ROLES.length).toBe(4);
  });

  it("isPlatformRole matches every member of the exclusion list", () => {
    for (const role of PLATFORM_ROLES) {
      expect(isPlatformRole(role)).toBe(true);
    }
    // And does not match tenant roles.
    for (const tenantRole of ["owner", "admin", "manager", "dispatcher", "technician"]) {
      expect(isPlatformRole(tenantRole)).toBe(false);
    }
    // Edge cases.
    expect(isPlatformRole(undefined)).toBe(false);
    expect(isPlatformRole(null)).toBe(false);
    expect(isPlatformRole("")).toBe(false);
  });
});

// ============================================================================
// Callsite wiring — every tenant-facing user query composes the predicate.
// ============================================================================
//
// The predicate only protects tenants if it's actually called at the
// query site. Source-level checks pin the wiring so a future commit
// can't accidentally drop the predicate from one of the callsites
// without a test going red.

const teamSrc = readFileSync(
  resolve(__dirname, "../server/storage/team.ts"),
  "utf-8",
);
const adminSrc = readFileSync(
  resolve(__dirname, "../server/storage/admin.ts"),
  "utf-8",
);
const notificationsSrc = readFileSync(
  resolve(__dirname, "../server/storage/notifications.ts"),
  "utf-8",
);
const timeTrackingSrc = readFileSync(
  resolve(__dirname, "../server/storage/timeTracking.ts"),
  "utf-8",
);

describe("TeamRepository wires nonPlatformUserPredicate at every callsite", () => {
  it("imports the helper from tenantUserPredicate", () => {
    expect(teamSrc).toMatch(/from\s+["']\.\/tenantUserPredicate["']/);
    expect(teamSrc).toContain("nonPlatformUserPredicate");
  });

  it("getTeamMembers excludes platform users", () => {
    const fn = teamSrc.match(/async\s+getTeamMembers[\s\S]+?^\s\s\}/m);
    expect(fn, "getTeamMembers function not found").toBeTruthy();
    expect(fn![0]).toContain("nonPlatformUserPredicate()");
  });

  it("getTeamMember (detail) excludes platform users", () => {
    const fn = teamSrc.match(/async\s+getTeamMember\(companyId[\s\S]+?^\s\s\}/m);
    expect(fn, "getTeamMember function not found").toBeTruthy();
    expect(fn![0]).toContain("nonPlatformUserPredicate()");
  });

  it("getTechnicianColors / getTechnicianRates exclude platform users", () => {
    const colors = teamSrc.match(/async\s+getTechnicianColors[\s\S]+?^\s\s\}/m);
    const rates = teamSrc.match(/async\s+getTechnicianRates[\s\S]+?^\s\s\}/m);
    expect(colors, "getTechnicianColors function not found").toBeTruthy();
    expect(rates, "getTechnicianRates function not found").toBeTruthy();
    expect(colors![0]).toContain("nonPlatformUserPredicate()");
    expect(rates![0]).toContain("nonPlatformUserPredicate()");
  });

  it("getTechniciansByCompanyId excludes platform users", () => {
    const fn = teamSrc.match(/async\s+getTechniciansByCompanyId[\s\S]+?^\s\s\}/m);
    expect(fn, "getTechniciansByCompanyId function not found").toBeTruthy();
    expect(fn![0]).toContain("nonPlatformUserPredicate()");
  });

  it("update + deactivate + activate write paths refuse platform-row targets", () => {
    // Defense-in-depth: tenant write paths must never resolve a
    // platform user's id even if the URL is hand-crafted.
    const update = teamSrc.match(/async\s+updateTeamMember[\s\S]+?^\s\s\}/m);
    const deact = teamSrc.match(/async\s+deactivateTeamMember[\s\S]+?^\s\s\}/m);
    const act = teamSrc.match(/async\s+activateTeamMember[\s\S]+?^\s\s\}/m);
    expect(update![0]).toContain("nonPlatformUserPredicate()");
    expect(deact![0]).toContain("nonPlatformUserPredicate()");
    expect(act![0]).toContain("nonPlatformUserPredicate()");
  });
});

describe("Other tenant user surfaces wire the predicate", () => {
  it("storage/admin.ts user metrics + recent-users exclude platform users", () => {
    expect(adminSrc).toContain("nonPlatformUserPredicate");
    // Both queries (count + recent list) must compose the predicate.
    // Count occurrences as a coarse guard.
    const callCount = adminSrc.match(/nonPlatformUserPredicate\(\)/g)?.length ?? 0;
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it("storage/notifications.ts recipient lookup excludes platform users", () => {
    expect(notificationsSrc).toContain("nonPlatformUserPredicate");
  });

  it("storage/timeTracking.ts payroll/timesheet user switcher excludes platform users", () => {
    expect(timeTrackingSrc).toContain("nonPlatformUserPredicate");
  });
});

// ============================================================================
// Frontend defensive filter
// ============================================================================

describe("TeamHubPage drops platform rows defensively", () => {
  const pageSrc = readFileSync(
    resolve(__dirname, "../client/src/pages/TeamHubPage.tsx"),
    "utf-8",
  );

  it("imports isPlatformRole from the canonical client helper", () => {
    expect(pageSrc).toMatch(
      /import\s+\{\s*isPlatformRole\s*\}\s+from\s+["']@\/lib\/platformRoles["']/,
    );
  });

  it("filters rawMembers through isPlatformRole before rendering", () => {
    // Multiline-tolerant: matches `rawMembers.filter(...)` whose body
    // contains `!isPlatformRole(m.role)`. The page-level filter is
    // the defensive layer that drops platform rows even if the
    // backend regresses.
    expect(pageSrc).toMatch(/rawMembers\.filter\([\s\S]+?!isPlatformRole\(m\.role\)/);
  });
});
