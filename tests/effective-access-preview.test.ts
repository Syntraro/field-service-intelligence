/**
 * Effective Access Preview — Phase 2 PR 3 (2026-05-04).
 *
 * Pins the new read-only endpoint + the pack-rollup helper + the
 * UI panel that surfaces them.
 *
 * Layered coverage:
 *
 *   1. Pack-rollup unit tests (`getPackAccess`) — pure logic; no DB.
 *   2. Live-DB endpoint tests — exercise
 *      `GET /api/team/:userId/effective-permissions` against the
 *      canonical resolver via direct route handler invocation. Covers
 *      role-only / grant override / revoke override / cross-tenant.
 *   3. Source pins on `RolesAccessTab.tsx` for the UI panel + on
 *      `server/routes/team.ts` for the endpoint shape.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { v4 as uuidv4 } from "uuid";
import { and, eq } from "drizzle-orm";

import { db } from "../server/db";
import {
  companies,
  users,
  roles,
  permissions,
  rolePermissions,
  userPermissionOverrides,
} from "@shared/schema";
import { storage } from "../server/storage/index";
import {
  permissionRepository,
  clearPermissionCache,
} from "../server/storage/permissions";

import {
  getPackAccess,
  PERMISSION_PACKS,
  ENFORCED_PERMISSION_KEYS,
} from "../client/src/lib/permissionPacks";

// ── Pack rollup unit tests ───────────────────────────────────────────

describe("getPackAccess — pack rollup logic", () => {
  it("returns one row per pack in canonical order", () => {
    const result = getPackAccess([]);
    expect(result.rows.map((r) => r.pack.id)).toEqual(
      PERMISSION_PACKS.map((p) => p.id),
    );
  });

  it("user with `dashboard.view` gets Operations = full (enforced key)", () => {
    const { byPackId } = getPackAccess(["dashboard.view"]);
    expect(byPackId.operations.status).toBe("full");
    expect(byPackId.operations.hasEnforcedAccess).toBe(true);
    expect(byPackId.operations.grantedCount).toBe(1);
  });

  it("user with `jobs.view` gets Operations = full and Dispatch = none", () => {
    const { byPackId } = getPackAccess(["jobs.view"]);
    expect(byPackId.operations.status).toBe("full");
    expect(byPackId.dispatch.status).toBe("none");
  });

  it("user with only an UNENFORCED pack key gets that pack = partial", () => {
    // 2026-05-04: `pricing.view` is in the Financials pack but
    // remains unenforced (no backend gate consults it). Granting it
    // alone leaves the pack at "partial" — the toggle is set but
    // doesn't change observable app behavior. Replaces the prior
    // pin on `pricing.edit`, which became enforced in PR 4.
    expect(ENFORCED_PERMISSION_KEYS.has("pricing.view")).toBe(false);
    const { byPackId } = getPackAccess(["pricing.view"]);
    expect(byPackId.financials.status).toBe("partial");
    expect(byPackId.financials.hasEnforcedAccess).toBe(false);
    expect(byPackId.financials.grantedCount).toBe(1);
  });

  it("empty effective set → every pack reports `none`", () => {
    const { rows } = getPackAccess([]);
    for (const r of rows) {
      expect(r.status).toBe("none");
      expect(r.grantedCount).toBe(0);
      expect(r.hasEnforcedAccess).toBe(false);
    }
  });

  it("granted counts cap at the pack's totalCount, status reflects enforcement", () => {
    const all = PERMISSION_PACKS.flatMap((p) => p.permissionKeys);
    const { rows } = getPackAccess(all);
    for (const r of rows) {
      // Every key granted → grantedCount == totalCount.
      expect(r.grantedCount).toBe(r.totalCount);
      // status == "full" only if the pack contains ≥1 enforced key
      // (the canonical product question — does anything actually
      // change at the gate layer). Packs whose entire key set is
      // unenforced stay "partial" even when fully granted: the
      // toggles are set but no backend route consults them. This is
      // the intended behavior — see ACCESS_CONTROL_MATRIX.md §5.
      const hasAnyEnforced = r.pack.permissionKeys.some((k) =>
        ENFORCED_PERMISSION_KEYS.has(k),
      );
      expect(r.status).toBe(hasAnyEnforced ? "full" : "partial");
    }
  });
});

// ── Live-DB: endpoint resolution and breakdown semantics ────────────

const PREFIX = "effective_access_preview_test_";

const tenantA = uuidv4();
const tenantB = uuidv4();
let ownerARoleId: string | null = null;
let technicianRoleId: string | null = null;
const ownerA = uuidv4();
const techA = uuidv4();
const ownerB = uuidv4();
let testPermissionIdToRevoke: string | null = null;
let testPermissionKeyToRevoke: string | null = null;

async function setupFixtures() {
  await db.insert(companies).values([
    { id: tenantA, name: `${PREFIX}A` },
    { id: tenantB, name: `${PREFIX}B` },
  ]);

  // Resolve seeded role ids.
  const roleRows = await db
    .select({ id: roles.id, name: roles.name })
    .from(roles);
  for (const r of roleRows) {
    if (r.name === "owner") ownerARoleId = r.id;
    if (r.name === "technician") technicianRoleId = r.id;
  }
  expect(ownerARoleId, "owner role must exist in seed").toBeTruthy();
  expect(technicianRoleId, "technician role must exist in seed").toBeTruthy();

  // Pick a permission technician has so we can test "revoke override".
  const techPermsRows = await db
    .select({ key: permissions.key, id: permissions.id })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(rolePermissions.roleId, technicianRoleId!));
  expect(techPermsRows.length, "technician role must have ≥1 perm").toBeGreaterThan(0);
  testPermissionIdToRevoke = techPermsRows[0].id;
  testPermissionKeyToRevoke = techPermsRows[0].key;

  await db.insert(users).values([
    {
      id: ownerA,
      companyId: tenantA,
      email: `${PREFIX}ownerA_${Date.now()}@t`,
      password: "x",
      role: "owner",
      roleId: ownerARoleId!,
      status: "active",
    },
    {
      id: techA,
      companyId: tenantA,
      email: `${PREFIX}techA_${Date.now()}@t`,
      password: "x",
      role: "technician",
      roleId: technicianRoleId!,
      status: "active",
    },
    {
      id: ownerB,
      companyId: tenantB,
      email: `${PREFIX}ownerB_${Date.now()}@t`,
      password: "x",
      role: "owner",
      roleId: ownerARoleId!,
      status: "active",
    },
  ]);
}

async function teardownFixtures() {
  for (const uid of [ownerA, techA, ownerB]) {
    await db
      .delete(userPermissionOverrides)
      .where(eq(userPermissionOverrides.userId, uid));
  }
  for (const tid of [tenantA, tenantB]) {
    await db.delete(users).where(eq(users.companyId, tid));
    await db.delete(companies).where(eq(companies.id, tid));
  }
  clearPermissionCache();
}

/**
 * Re-implements the route handler body so we can exercise it without
 * the express test fixture (which doesn't exist in this suite). The
 * shape MUST match `server/routes/team.ts` — kept in sync via the
 * source-pin tests below.
 */
async function callEffectivePermissions(
  callerCompanyId: string,
  userId: string,
): Promise<{ status: number; body: any }> {
  const member = await storage.getTeamMember(callerCompanyId, userId);
  if (!member) return { status: 404, body: { error: "Team member not found" } };

  const effectiveSet =
    await permissionRepository.getUserEffectivePermissions(userId);
  let inheritedFromRole: string[] = [];
  if (member.roleId) {
    inheritedFromRole = await permissionRepository.getRolePermissions(
      member.roleId,
    );
  }
  const rawOverrides =
    await permissionRepository.getUserPermissionOverrides(userId);
  const grantedByOverride: string[] = [];
  const revokedByOverride: string[] = [];
  for (const o of rawOverrides) {
    if (o.override === "grant") grantedByOverride.push(o.key);
    else if (o.override === "revoke") revokedByOverride.push(o.key);
  }
  return {
    status: 200,
    body: {
      userId,
      role: member.role,
      roleId: member.roleId ?? null,
      effective: Array.from(effectiveSet).sort(),
      inheritedFromRole: inheritedFromRole.slice().sort(),
      grantedByOverride: grantedByOverride.slice().sort(),
      revokedByOverride: revokedByOverride.slice().sort(),
    },
  };
}

describe("GET /api/team/:userId/effective-permissions — semantics", () => {
  beforeAll(async () => {
    await setupFixtures();
  });
  afterAll(async () => {
    await teardownFixtures();
  });

  it("role-only user: effective == inheritedFromRole, no overrides", async () => {
    clearPermissionCache(techA);
    const { status, body } = await callEffectivePermissions(tenantA, techA);
    expect(status).toBe(200);
    expect(body.role).toBe("technician");
    expect(body.roleId).toBe(technicianRoleId);
    expect(body.grantedByOverride).toEqual([]);
    expect(body.revokedByOverride).toEqual([]);
    expect(body.effective.sort()).toEqual(body.inheritedFromRole.sort());
  });

  it("grant override: key appears in grantedByOverride and effective", async () => {
    // Pick a key the technician role does NOT have. owner role has all
    // permissions, so any owner-only key works. We use `permissions.manage`
    // which is admin-tier and not in the technician seed.
    const adminKey = "permissions.manage";
    const adminPerm = await db
      .select({ id: permissions.id })
      .from(permissions)
      .where(eq(permissions.key, adminKey))
      .limit(1);
    expect(adminPerm.length).toBe(1);

    await db.insert(userPermissionOverrides).values({
      userId: techA,
      permissionId: adminPerm[0].id,
      override: "grant",
    });
    clearPermissionCache(techA);

    const { status, body } = await callEffectivePermissions(tenantA, techA);
    expect(status).toBe(200);
    expect(body.grantedByOverride).toContain(adminKey);
    expect(body.effective).toContain(adminKey);
    // Should NOT be in inherited set — it's owner-only.
    expect(body.inheritedFromRole).not.toContain(adminKey);

    // Cleanup.
    await db
      .delete(userPermissionOverrides)
      .where(
        and(
          eq(userPermissionOverrides.userId, techA),
          eq(userPermissionOverrides.permissionId, adminPerm[0].id),
        ),
      );
    clearPermissionCache(techA);
  });

  it("revoke override: key appears in revokedByOverride and NOT in effective", async () => {
    expect(testPermissionIdToRevoke).toBeTruthy();
    expect(testPermissionKeyToRevoke).toBeTruthy();

    await db.insert(userPermissionOverrides).values({
      userId: techA,
      permissionId: testPermissionIdToRevoke!,
      override: "revoke",
    });
    clearPermissionCache(techA);

    const { status, body } = await callEffectivePermissions(tenantA, techA);
    expect(status).toBe(200);
    expect(body.revokedByOverride).toContain(testPermissionKeyToRevoke);
    expect(body.inheritedFromRole).toContain(testPermissionKeyToRevoke);
    expect(body.effective).not.toContain(testPermissionKeyToRevoke);

    // Cleanup.
    await db
      .delete(userPermissionOverrides)
      .where(
        and(
          eq(userPermissionOverrides.userId, techA),
          eq(
            userPermissionOverrides.permissionId,
            testPermissionIdToRevoke!,
          ),
        ),
      );
    clearPermissionCache(techA);
  });

  it("cross-tenant: caller from tenantA looking up tenantB user → 404 (no leak)", async () => {
    const { status, body } = await callEffectivePermissions(tenantA, ownerB);
    expect(status).toBe(404);
    // Body must NOT contain any tenantB user data.
    expect(body.role).toBeUndefined();
    expect(body.effective).toBeUndefined();
  });

  it("pack rollup over the live result: technician → Operations = full", async () => {
    clearPermissionCache(techA);
    const { body } = await callEffectivePermissions(tenantA, techA);
    const { byPackId } = getPackAccess(body.effective);
    expect(byPackId.operations.status).toBe("full"); // jobs.view + clients.view.basic
    expect(byPackId.operations.hasEnforcedAccess).toBe(true);
    // Technician has no admin pack access.
    expect(byPackId["admin-settings"].status).toBe("none");
  });
});

// ── Source pins ──────────────────────────────────────────────────────

describe("Backend wiring — /api/team/:userId/effective-permissions exists", () => {
  const teamSrc = readFileSync(
    resolve(__dirname, "../server/routes/team.ts"),
    "utf-8",
  );

  it("declares the route on the team router", () => {
    expect(teamSrc).toMatch(
      /router\.get\(\s*["']\/:userId\/effective-permissions["']/,
    );
  });

  it("reuses permissionRepository.getUserEffectivePermissions (no duplicate logic)", () => {
    expect(teamSrc).toMatch(/permissionRepository\.getUserEffectivePermissions/);
    expect(teamSrc).toMatch(/permissionRepository\.getRolePermissions/);
    expect(teamSrc).toMatch(/permissionRepository\.getUserPermissionOverrides/);
  });

  it("response body includes the four required arrays + role + roleId + userId", () => {
    // Pull just the handler block so unrelated res.json calls don't
    // satisfy the assertion.
    const handler = teamSrc.match(
      /router\.get\(\s*["']\/:userId\/effective-permissions["'][\s\S]*?\}\)\s*\)\s*;/,
    );
    expect(handler).toBeTruthy();
    const block = handler![0];
    expect(block).toMatch(/userId,/);
    expect(block).toMatch(/role:\s*member\.role/);
    expect(block).toMatch(/roleId:\s*member\.roleId\s*\?\?\s*null/);
    expect(block).toMatch(/effective:\s*Array\.from\(effectiveSet\)/);
    expect(block).toMatch(/inheritedFromRole:/);
    expect(block).toMatch(/grantedByOverride:/);
    expect(block).toMatch(/revokedByOverride:/);
  });

  it("uses `storage.getTeamMember` for tenant scoping (404 on cross-tenant)", () => {
    const handler = teamSrc.match(
      /router\.get\(\s*["']\/:userId\/effective-permissions["'][\s\S]*?\}\)\s*\)\s*;/,
    );
    const block = handler![0];
    expect(block).toMatch(/storage\.getTeamMember\(\s*companyId\s*,\s*userId\s*\)/);
    expect(block).toMatch(/Team member not found/);
  });
});

describe("Frontend wiring — RolesAccessTab Effective Access panel", () => {
  const tabSrc = readFileSync(
    resolve(__dirname, "../client/src/components/team-hub/RolesAccessTab.tsx"),
    "utf-8",
  );

  it("queries the new endpoint with a stable cache key", () => {
    expect(tabSrc).toMatch(
      /\[`\/api\/team\/\$\{displayedId\}\/effective-permissions`\]/,
    );
  });

  it("renders the read-only EffectiveAccessPanel", () => {
    expect(tabSrc).toMatch(/data-testid="effective-access-panel"/);
    expect(tabSrc).toMatch(/What this user can access/);
  });

  it("renders the pack rollup + per-pack status badges", () => {
    expect(tabSrc).toMatch(/data-testid="effective-pack-rollup"/);
    expect(tabSrc).toMatch(
      /data-testid=\{`pack-status-\$\{packId\}`\}/,
    );
    // Status copy (full / partial / none).
    expect(tabSrc).toMatch(/Has access/);
    expect(tabSrc).toMatch(/Partial/);
    expect(tabSrc).toMatch(/No access/);
  });

  it("renders the three breakdown sections (inherited / granted / revoked)", () => {
    expect(tabSrc).toMatch(/data-testid="effective-breakdown"/);
    expect(tabSrc).toMatch(/data-testid=\{`effective-breakdown-\$\{testIdSuffix\}`\}/);
    expect(tabSrc).toMatch(/Inherited from role/);
    expect(tabSrc).toMatch(/Granted by override/);
    expect(tabSrc).toMatch(/Revoked by override/);
  });

  it("uses getPackAccess from the shared permissionPacks module", () => {
    expect(tabSrc).toMatch(/getPackAccess/);
    expect(tabSrc).toMatch(/from\s+["']@\/lib\/permissionPacks["']/);
  });

  it("invalidates the effective-permissions query when role/overrides save", () => {
    // Both saveRole and savePerms invalidate this query so the panel
    // refreshes after a change.
    const matches = tabSrc.match(/\/api\/team\/\$\{displayedId\}\/effective-permissions/g);
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
