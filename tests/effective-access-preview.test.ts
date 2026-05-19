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

  it("renders the read-only EffectiveAccessPanel under the v2 'Access Summary' title", () => {
    // 2026-05-05 simplification: panel title renamed from "What this
    // user can access" → "Access Summary". Resolver wiring + the
    // data-testid hooks remain unchanged.
    expect(tabSrc).toMatch(/data-testid="effective-access-panel"/);
    expect(tabSrc).toMatch(/Access Summary/);
    // Old title is gone from the rendered JSX. (A docblock comment
    // may still mention it — pin only that the literal doesn't sit
    // between a `>` and a `<` like a JSX text node would.)
    expect(tabSrc).not.toMatch(/>\s*What this user can access\s*</);
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

  // ─── v2: simplification pass (2026-05-05) ───────────────────────────

  it("breakdown sections (inherited/granted/revoked) are collapsed by default behind a 'View detailed permissions' disclosure", () => {
    // 2026-05-05 brief: "Default: Only show pack rows. Move detailed
    // sections under expandable areas."
    expect(tabSrc).toMatch(/data-testid="effective-details-trigger"/);
    expect(tabSrc).toMatch(/View detailed permissions/);
    // Collapsed-by-default state: `useState(false)` for `detailsOpen`.
    expect(tabSrc).toMatch(/setDetailsOpen\s*\]\s*=\s*useState\(false\)/);
    // The breakdown div sits inside a `<CollapsibleContent>` — assert
    // the structural ordering: trigger → CollapsibleContent → div
    // with effective-breakdown testid.
    expect(tabSrc).toMatch(
      /effective-details-trigger[\s\S]+?CollapsibleContent[\s\S]+?data-testid="effective-breakdown"/,
    );
  });

  it("Advanced Controls card wraps the override editor and is collapsed by default", () => {
    // 2026-05-05 brief: "Move Permission Overrides to Advanced.
    // Section: Advanced Controls. Collapsed by default."
    expect(tabSrc).toMatch(/data-testid="advanced-controls-card"/);
    expect(tabSrc).toMatch(/data-testid="advanced-controls-trigger"/);
    expect(tabSrc).toMatch(/Advanced Controls/);
    // Helper text per the brief.
    expect(tabSrc).toMatch(
      /Advanced controls for fine-tuning access\. Most\s+users should not need this\./,
    );
    // Collapsed-by-default state.
    expect(tabSrc).toMatch(
      /setAdvancedOpen\s*\]\s*=\s*useState\(false\)/,
    );
    // The override pack list still lives inside the disclosure
    // (collapsible content), so its data-testid remains in the
    // source — but it sits under the Collapsible.
    expect(tabSrc).toMatch(
      /advanced-controls-trigger[\s\S]+?CollapsibleContent[\s\S]+?data-testid="override-pack-list"/,
    );
  });

  it("Access Summary renders BEFORE Advanced Controls in the source order", () => {
    // 2026-05-05 brief: Access Summary is the primary management UI;
    // Advanced Controls (the override editor) is the secondary
    // collapsible. Source order locks this — the EffectiveAccessPanel
    // mount must precede the advanced-controls card.
    expect(tabSrc).toMatch(
      /<EffectiveAccessPanel[\s\S]+?advanced-controls-card/,
    );
  });

  it("save endpoints + payload shapes are unchanged (v2 simplification has no backend changes)", () => {
    // The brief: "UI only (no backend changes)". Pin both save paths
    // structurally to lock that.
    expect(tabSrc).toMatch(
      /apiRequest\(\s*`\/api\/team\/\$\{displayedId\}`,\s*\{\s*method:\s*"PATCH"/,
    );
    expect(tabSrc).toMatch(
      /apiRequest\(\s*`\/api\/team\/\$\{displayedId\}\/permissions`,\s*\{\s*method:\s*"PUT"/,
    );
    expect(tabSrc).toMatch(/JSON\.stringify\(\{\s*overrides:/);
  });
});

// ─── v2: TeamHubPage simplification (2026-05-05) ─────────────────────

describe("TeamHubPage v2 — KPI strip removed, header simplified", () => {
  const teamHubSrc = readFileSync(
    resolve(__dirname, "../client/src/pages/TeamHubPage.tsx"),
    "utf-8",
  );

  it("does NOT render the TeamMetricsStrip (5 KPI cards above the tabs are gone)", () => {
    // The strip component is no longer mounted. The component file
    // itself can stay on disk — the brief says "no broad refactor /
    // do not remove unrelated functionality" — but it MUST NOT be
    // imported or rendered here.
    expect(teamHubSrc).not.toMatch(/<TeamMetricsStrip\b/);
    expect(teamHubSrc).not.toMatch(
      /import\s*\{\s*TeamMetricsStrip\s*\}\s*from/,
    );
  });

  it("page title is the simplified 'Team' (was 'Team Management')", () => {
    // The h1 with the testid renders `<h1 ... data-testid="text-team-hub-title">
    // Team </h1>`. The `>` immediately following the attribute closes
    // the open tag; the JSX text "Team" sits between two whitespace
    // sequences. Match: testid + `>` + whitespace + `Team` + whitespace + `<`.
    expect(teamHubSrc).toMatch(
      /data-testid="text-team-hub-title"\s*>\s*Team\s*</,
    );
    // The previous "Team Management" page heading is gone.
    expect(teamHubSrc).not.toMatch(
      /data-testid="text-team-hub-title"\s*>\s*Team Management\s*</,
    );
  });

  it("page subtitle reframes the page as team management hub + drops the active/total count", () => {
    expect(teamHubSrc).toMatch(/data-testid="text-team-subtitle"/);
    // The previous "X active · Y total" subtitle was removed.
    expect(teamHubSrc).not.toMatch(/text-team-count/);
  });

  it("Invite + Add Member action buttons preserved", () => {
    expect(teamHubSrc).toMatch(/data-testid="button-invite"/);
    expect(teamHubSrc).toMatch(/data-testid="button-add-member"/);
  });

  it("does NOT mount its own member-level tabs — those live in TeamMemberWorkspace", () => {
    // 2026-05-05 v4 member-centric restructure: tabs and tab content
    // moved into <TeamMemberWorkspace>. TeamHubPage is now a 2-column
    // shell that hosts <TeamMemberList> + <TeamMemberWorkspace>.
    expect(teamHubSrc).not.toMatch(/data-testid="tab-members"/);
    expect(teamHubSrc).not.toMatch(/data-testid="tab-schedules"/);
    // Tab testids that previously lived on this page are gone — they
    // now live (renamed) on the workspace.
    expect(teamHubSrc).not.toMatch(/data-testid="tab-overview"\s/);
    expect(teamHubSrc).not.toMatch(/data-testid="tab-schedule"\s/);
    expect(teamHubSrc).not.toMatch(/data-testid="tab-compensation"\s/);
    expect(teamHubSrc).not.toMatch(/data-testid="tab-access"\s/);
  });

  it("renders the 2-column workspace layout (TeamMemberList + TeamMemberWorkspace)", () => {
    // The page is now a shared-sidebar layout, not a top-level tabbed
    // surface. Pin imports + JSX usage of both new components.
    expect(teamHubSrc).toMatch(
      /import\s*\{\s*TeamMemberList\s*\}\s*from\s*["']@\/components\/team-hub\/TeamMemberList["']/,
    );
    expect(teamHubSrc).toMatch(
      /import\s*\{\s*\n?\s*TeamMemberWorkspace,?[\s\S]*?\}\s*from\s*["']@\/components\/team-hub\/TeamMemberWorkspace["']/,
    );
    expect(teamHubSrc).toMatch(/<TeamMemberList\b/);
    expect(teamHubSrc).toMatch(/<TeamMemberWorkspace\b/);
    // The 2-column grid uses a 300px sidebar column. Pin the className
    // so a future regression that breaks the layout fails this test.
    expect(teamHubSrc).toMatch(/grid-cols-\[300px_1fr\]/);
  });

  it("does NOT mount the legacy MembersTab on the Overview surface", () => {
    // 2026-05-05 brief: "Overview is a per-member profile editor, not
    // the legacy table of every member." MembersTab must not be
    // referenced from this page (the file remains on disk for callers
    // we haven't audited, but the Hub no longer mounts it).
    expect(teamHubSrc).not.toMatch(/<MembersTab\b/);
    expect(teamHubSrc).not.toMatch(
      /import\s*\{\s*MembersTab\s*\}\s*from/,
    );
  });

  it("legacy `?tab=members | schedules` URL values still resolve (LEGACY_TAB_ALIAS map)", () => {
    // Soft-deprecation: old deep-links must not 404. The
    // LEGACY_TAB_ALIAS map silently rewrites them onto the new ids.
    expect(teamHubSrc).toMatch(/LEGACY_TAB_ALIAS/);
    expect(teamHubSrc).toMatch(/members:\s*"performance"/);
    // schedule/schedules aliases now redirect to permissions (schedule tab removed)
    expect(teamHubSrc).toMatch(/schedules:\s*"permissions"/);
  });

  it("VALID_TABS lists the current ids (Performance / Payroll / Permissions / Skills)", () => {
    expect(teamHubSrc).toMatch(
      /VALID_TABS\s*=\s*\[\s*"performance",\s*"payroll",\s*"permissions",\s*"skills"\s*\]/,
    );
    // Schedule tab removed — Shift Management is now canonical
    expect(teamHubSrc).not.toMatch(/"schedule"/);
  });
});

// ─── v4: Team Hub member-centric workspace (2026-05-05) ─────────────

describe("TeamMemberList — single shared sidebar", () => {
  const listSrc = readFileSync(
    resolve(
      __dirname,
      "../client/src/components/team-hub/TeamMemberList.tsx",
    ),
    "utf-8",
  );

  it("queries /api/team for the canonical roster", () => {
    expect(listSrc).toMatch(/queryKey:\s*\[\s*["']\/api\/team["']\s*\]/);
  });

  it("calls onSelect(id) when a row is clicked (no inner navigation state)", () => {
    expect(listSrc).toMatch(/onClick=\{\(\)\s*=>\s*onSelect\(m\.id\)/);
    // The list itself owns no member-id state — selection comes from
    // props (the page-level URL param).
    expect(listSrc).toMatch(/selectedMemberId\s*===?\s*m\.id|m\.id\s*===\s*selectedMemberId/);
  });

  it("exposes per-row testids for source-pin tests", () => {
    expect(listSrc).toMatch(
      /data-testid=\{`button-team-list-select-\$\{m\.id\}`\}/,
    );
    expect(listSrc).toMatch(/data-testid="team-member-list"/);
  });

  it("provides search + status + role filters in the header", () => {
    expect(listSrc).toMatch(/data-testid="input-team-list-search"/);
    expect(listSrc).toMatch(/data-testid="select-team-list-status"/);
    expect(listSrc).toMatch(/data-testid="select-team-list-role"/);
  });
});

describe("TeamMemberWorkspace — member-level tabs all share one selection", () => {
  const wsSrc = readFileSync(
    resolve(
      __dirname,
      "../client/src/components/team-hub/TeamMemberWorkspace.tsx",
    ),
    "utf-8",
  );

  it("renders the member-level tabs (Performance / Payroll & Cost / Permissions / Skills)", () => {
    expect(wsSrc).toMatch(/data-testid="tab-workspace-performance"/);
    expect(wsSrc).toMatch(/data-testid="tab-workspace-payroll"/);
    expect(wsSrc).toMatch(/data-testid="tab-workspace-permissions"/);
    expect(wsSrc).toMatch(/data-testid="tab-workspace-skills"/);
    // Schedule tab removed — Shift Management is now canonical
    expect(wsSrc).not.toMatch(/data-testid="tab-workspace-schedule"/);
  });

  it("mounts the tab components with hideMemberList=true so they skip their own sidebars", () => {
    // 2026-05-05 brief: "No tab has its own separate member list."
    // The workspace passes `hideMemberList` to every tab it mounts.
    expect(wsSrc).toMatch(/<CompensationTab[\s\S]+?hideMemberList[\s\S]+?\/>/);
    expect(wsSrc).toMatch(/<RolesAccessTab[\s\S]+?hideMemberList[\s\S]+?\/>/);
  });

  it("Overview tab mounts the new MemberOverviewPanel (not MembersTab)", () => {
    // The brief: Overview is a per-member profile editor, not the
    // legacy multi-member table.
    expect(wsSrc).toMatch(/<MemberOverviewPanel\b/);
    expect(wsSrc).not.toMatch(/<MembersTab\b/);
  });

  it("renders a selected-member header with activate/deactivate routed through the existing endpoint", () => {
    expect(wsSrc).toMatch(/data-testid="text-workspace-member-name"/);
    expect(wsSrc).toMatch(/data-testid="button-workspace-toggle-status"/);
    // Existing /api/team/:id/{activate|deactivate} endpoints — the
    // brief says backend behavior is unchanged.
    expect(wsSrc).toMatch(
      /apiRequest\(\s*`\/api\/team\/\$\{selectedMemberId\}\/\$\{action\}`/,
    );
  });

  it("shows an empty state when no member is selected (no auto-redirect, no auto-pick)", () => {
    // The brief: "User clicks a member once / Right panel updates to
    // that member." First load is empty — no surprise auto-selection
    // that rewrites the URL on mount.
    expect(wsSrc).toMatch(/data-testid="team-workspace-empty"/);
    expect(wsSrc).toMatch(/Select a team member/);
  });
});

describe("MemberOverviewPanel — complete basic-profile editor (v2 refinement)", () => {
  const ovSrc = readFileSync(
    resolve(
      __dirname,
      "../client/src/components/team-hub/MemberOverviewPanel.tsx",
    ),
    "utf-8",
  );

  it("renders the four basic-profile inputs (first name / last name / phone / email)", () => {
    expect(ovSrc).toMatch(/data-testid="input-overview-first-name"/);
    expect(ovSrc).toMatch(/data-testid="input-overview-last-name"/);
    expect(ovSrc).toMatch(/data-testid="input-overview-phone"/);
    expect(ovSrc).toMatch(/data-testid="input-overview-email"/);
  });

  it("email field is read-only (login identifier, edited elsewhere)", () => {
    // Pin the readOnly+disabled flags on the email input so a future
    // regression that opens it for in-place edit fails the test.
    expect(ovSrc).toMatch(
      /id="overview-email"[\s\S]*?readOnly[\s\S]*?disabled/,
    );
  });

  it("renders Last login + Joined date as read-only summary lines", () => {
    expect(ovSrc).toMatch(/data-testid="overview-last-login"/);
    expect(ovSrc).toMatch(/data-testid="overview-joined-date"/);
  });

  it("renders a 'Send password reset' action wired to the canonical endpoint", () => {
    expect(ovSrc).toMatch(/data-testid="button-overview-reset-password"/);
    expect(ovSrc).toMatch(
      /apiRequest\(\s*`\/api\/team\/\$\{selectedMemberId\}\/send-password-reset`,\s*\{\s*method:\s*"POST"/,
    );
  });

  it("save button persists firstName / lastName / phone via PATCH /api/team/:userId", () => {
    expect(ovSrc).toMatch(/data-testid="button-overview-save"/);
    expect(ovSrc).toMatch(
      /apiRequest\(\s*`\/api\/team\/\$\{selectedMemberId\}`,\s*\{\s*method:\s*"PATCH"/,
    );
    // Payload includes the three editable fields; non-editable ones
    // are passed through unchanged so the validator doesn't see them
    // as cleared.
    expect(ovSrc).toMatch(/firstName:\s*form\.firstName/);
    expect(ovSrc).toMatch(/lastName:\s*form\.lastName/);
    expect(ovSrc).toMatch(/phone:\s*form\.phone/);
    expect(ovSrc).toMatch(/roleId:\s*member\.roleId\s*\?\?\s*undefined/);
  });

  it("does NOT render a role dropdown — role lives only in the Access tab", () => {
    // The brief: "Role should NOT be editable in Overview." Pin both
    // the absence of the canonical role-select testid AND the absence
    // of any roleId mutation field on the form state.
    expect(ovSrc).not.toMatch(/data-testid="select-roles-role"/);
    expect(ovSrc).not.toMatch(/data-testid=".*role.*select"/i);
    // No <Select> import — the panel is input-only.
    expect(ovSrc).not.toMatch(/from\s+["']@\/components\/ui\/select["']/);
  });

  it("does NOT render a 'More profile settings' / 'Full profile' link in the normal flow", () => {
    // The brief: "Remove 'More profile settings' link/card from the
    // normal flow." Overview is now the complete profile editor;
    // the legacy /manage-team/:id route is kept for compat but is
    // not linked from here.
    expect(ovSrc).not.toMatch(/More profile settings/);
    expect(ovSrc).not.toMatch(/Full profile/);
    expect(ovSrc).not.toMatch(/href=\{?\s*`?\/manage-team\//);
    expect(ovSrc).not.toMatch(/data-testid="button-overview-full-profile"/);
  });

  it("mounts CalendarSyncSection below the profile fields (per-user ICS subscription)", () => {
    // 2026-05-05 v3 follow-up: the v2 simplification accidentally
    // dropped Calendar Sync. It must remain visible on Overview.
    // The CalendarSyncSection component itself owns the queries /
    // mutations against /api/team/:userId/calendar-token — we only
    // need to confirm the import + mount.
    expect(ovSrc).toMatch(
      /import\s*\{\s*CalendarSyncSection\s*\}\s*from\s*["']\.\/CalendarSyncSection["']/,
    );
    expect(ovSrc).toMatch(/<CalendarSyncSection\b[\s\S]+?userId=\{selectedMemberId\}/);
  });

  it("does NOT render bulky helper paragraphs / explanatory copy", () => {
    // The brief: "no large helper paragraphs / no unnecessary section
    // descriptions / no duplicate member name/email blocks". The v1
    // panel had a "Basic identity fields…" subtitle and an email
    // helper paragraph; both are removed.
    expect(ovSrc).not.toMatch(/Basic identity fields/);
    expect(ovSrc).not.toMatch(
      /Email is the login identifier/,
    );
    // The CardHeader ("Profile" title) is gone — the panel goes
    // straight to the inputs.
    expect(ovSrc).not.toMatch(/<CardTitle[^>]*>\s*Profile\s*</);
  });
});

describe("CalendarSyncSection — restored to Overview, reuses existing endpoints", () => {
  const csSrc = readFileSync(
    resolve(
      __dirname,
      "../client/src/components/team-hub/CalendarSyncSection.tsx",
    ),
    "utf-8",
  );
  const teamRoutesSrc = readFileSync(
    resolve(__dirname, "../server/routes/team.ts"),
    "utf-8",
  );

  it("queries the existing GET /api/team/:userId/calendar-token endpoint", () => {
    expect(csSrc).toMatch(
      /apiRequest\(\s*`\/api\/team\/\$\{userId\}\/calendar-token`\s*\)/,
    );
    // Server-side route is preserved (no backend changes).
    expect(teamRoutesSrc).toMatch(
      /router\.get\(\s*["']\/:userId\/calendar-token["']/,
    );
  });

  it("posts to the four canonical mutation endpoints (create / rotate / disable / enable)", () => {
    // Frontend mutation paths.
    expect(csSrc).toMatch(/`\/api\/team\/\$\{userId\}\/calendar-token`,\s*\{\s*method:\s*"POST"/);
    expect(csSrc).toMatch(/`\/api\/team\/\$\{userId\}\/calendar-token\/rotate`,\s*\{\s*method:\s*"POST"/);
    expect(csSrc).toMatch(/`\/api\/team\/\$\{userId\}\/calendar-token\/disable`,\s*\{\s*method:\s*"POST"/);
    expect(csSrc).toMatch(/`\/api\/team\/\$\{userId\}\/calendar-token\/enable`,\s*\{\s*method:\s*"POST"/);
    // Server-side counterparts unchanged.
    expect(teamRoutesSrc).toMatch(/router\.post\(\s*["']\/:userId\/calendar-token["']/);
    expect(teamRoutesSrc).toMatch(/router\.post\(\s*["']\/:userId\/calendar-token\/rotate["']/);
    expect(teamRoutesSrc).toMatch(/router\.post\(\s*["']\/:userId\/calendar-token\/disable["']/);
    expect(teamRoutesSrc).toMatch(/router\.post\(\s*["']\/:userId\/calendar-token\/enable["']/);
  });

  it("renders 'Create link' button when no token exists", () => {
    // The brief: state #1 — "No link exists → 'No calendar link yet.'
    // Button: 'Create link'".
    expect(csSrc).toMatch(/data-testid="calendar-sync-create"/);
    expect(csSrc).toMatch(/No calendar link yet\./);
    expect(csSrc).toMatch(/Create link/);
  });

  it("renders read-only feed URL + Copy + Regenerate when token exists and active", () => {
    // The brief: state #2 — "Link exists → read-only URL + 'Copy link'
    // + 'Regenerate' if existing behavior supports it." All three
    // controls are wired to the existing mutations above.
    expect(csSrc).toMatch(/data-testid="calendar-sync-feed-url"/);
    expect(csSrc).toMatch(/readOnly\b/);
    expect(csSrc).toMatch(/data-testid="calendar-sync-copy"/);
    expect(csSrc).toMatch(/data-testid="calendar-sync-rotate"/);
  });

  it("ICS feed is read-only — no write-back endpoint or mutation is called", () => {
    // The brief: "Do not expose write-back calendar behavior; this is
    // read-only ICS." Pin the absence of any POST that would push
    // changes back from an external calendar.
    expect(csSrc).not.toMatch(/calendar-token\/sync-back/);
    expect(csSrc).not.toMatch(/calendar-token\/import/);
    expect(csSrc).not.toMatch(/method:\s*"PUT"/);
    expect(csSrc).not.toMatch(/method:\s*"PATCH"/);
    // The descriptive copy reinforces the read-only contract.
    expect(csSrc).toMatch(/read-only/i);
  });
});

describe("RolesAccessTab — owns role management (v2 refinement pin)", () => {
  const rolesSrc = readFileSync(
    resolve(
      __dirname,
      "../client/src/components/team-hub/RolesAccessTab.tsx",
    ),
    "utf-8",
  );

  it("still renders the canonical role <Select> + Save role button", () => {
    // The brief: "Access tab should contain Role dropdown / Save role /
    // Role hierarchy warning". Don't let a future refactor break
    // role editing inside this tab.
    expect(rolesSrc).toMatch(/data-testid="select-roles-role"/);
    expect(rolesSrc).toMatch(/data-testid="button-roles-save-role"/);
    // Role save endpoint preserved (same shape used everywhere else).
    expect(rolesSrc).toMatch(
      /apiRequest\(\s*`\/api\/team\/\$\{displayedId\}`,\s*\{\s*method:\s*"PATCH"/,
    );
    expect(rolesSrc).toMatch(/roleId,?\s*\}/);
  });

  it("renders the role hierarchy guard copy", () => {
    // The brief: "Role hierarchy warning" must remain.
    expect(rolesSrc).toMatch(
      /Role hierarchy is enforced server-side/,
    );
  });
});

describe("Tabs accept hideMemberList prop for workspace embedding", () => {
  const compSrc = readFileSync(
    resolve(
      __dirname,
      "../client/src/components/team-hub/CompensationTab.tsx",
    ),
    "utf-8",
  );
  const rolesSrc = readFileSync(
    resolve(
      __dirname,
      "../client/src/components/team-hub/RolesAccessTab.tsx",
    ),
    "utf-8",
  );

  for (const [name, src] of [
    ["CompensationTab", compSrc] as const,
    ["RolesAccessTab", rolesSrc] as const,
  ]) {
    it(`${name} declares an optional hideMemberList prop on its Props interface`, () => {
      expect(src).toMatch(/hideMemberList\?:\s*boolean/);
    });
    it(`${name} skips rendering its inner member-list Card when hideMemberList=true`, () => {
      // The component wraps its sidebar Card in `{!hideMemberList && (`
      // so when the workspace passes the prop, the inner sidebar is
      // omitted and the right pane occupies the full column.
      expect(src).toMatch(/\{\s*!\s*hideMemberList\s*&&/);
      // And the outer grid collapses to a single column when hidden.
      expect(src).toMatch(
        /hideMemberList[\s\S]+?grid-cols-1\b[\s\S]+?grid-cols-\[260px_1fr\]/,
      );
    });
  }
});

describe("App routing — v3 member-centric short-path aliases", () => {
  const appSrc = readFileSync(
    resolve(__dirname, "../client/src/App.tsx"),
    "utf-8",
  );

  it("`/team` short-path renders the canonical TeamHubPage", () => {
    // The path `/team` is added alongside `/settings/team` (canonical
    // mount) so users can deep-link the shorter URL.
    expect(appSrc).toMatch(/path="\/team"[\s\S]+?<TeamHubPage\s*\/>/);
    // The canonical mount at /settings/team is preserved.
    expect(appSrc).toMatch(
      /path="\/settings\/team"[\s\S]+?<TeamHubPage\s*\/>/,
    );
  });

  it("legacy `/team/schedules` redirects to canonical Shift Management; `/team/compensation` redirects to Hub", () => {
    // Schedule tab removed — Shift Management is now canonical
    expect(appSrc).toMatch(
      /path="\/team\/schedules"[\s\S]+?<Redirect to="\/shift-management"\s*\/>/,
    );
    expect(appSrc).toMatch(
      /path="\/team\/compensation"[\s\S]+?<Redirect to="\/team\?tab=compensation"\s*\/>/,
    );
    // Plus the access alias the brief lets us keep symmetric.
    expect(appSrc).toMatch(
      /path="\/team\/access"[\s\S]+?<Redirect to="\/team\?tab=access"\s*\/>/,
    );
  });
});
