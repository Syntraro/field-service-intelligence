/**
 * Role / Permission UI grouping pins — Phase 2 PR 2 (2026-05-04).
 *
 * Locks the visual + structural decisions made in
 * `docs/ACCESS_CONTROL_MATRIX.md` PR 2:
 *
 *   1. System-role badge + lock affordance on `/manage-roles`.
 *   2. "Clone to custom role" CTA replaces Edit/Delete for system roles.
 *   3. Create custom role button revealed (was previously hidden).
 *   4. Permission pack mapping (8 packs from the matrix doc) drives
 *      the editor render.
 *   5. Advanced disclosure hides noisy / unenforced permissions.
 *   6. Per-user override editor groups by pack and preserves the
 *      Allow/Deny/Inherit save shape.
 *   7. Save endpoints unchanged — wire format is untouched.
 *
 * No backend changes in PR 2; these are source-level pins only.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

import {
  PERMISSION_PACKS,
  ADVANCED_PERMISSION_KEYS,
  ENFORCED_PERMISSION_KEYS,
  packIdForPermissionKey,
  isAdvancedPermission,
  isPermissionEnforced,
  groupPermissionsByPack,
} from "../client/src/lib/permissionPacks";

const manageRolesSrc = readFileSync(
  resolve(__dirname, "../client/src/pages/ManageRoles.tsx"),
  "utf-8",
);
const rolesAccessSrc = readFileSync(
  resolve(__dirname, "../client/src/components/team-hub/RolesAccessTab.tsx"),
  "utf-8",
);
const packsSrc = readFileSync(
  resolve(__dirname, "../client/src/lib/permissionPacks.ts"),
  "utf-8",
);

// ── Pack mapping module — shape & invariants ────────────────────────

describe("permissionPacks — module shape", () => {
  it("declares exactly 8 packs in the order from ACCESS_CONTROL_MATRIX.md §3", () => {
    expect(PERMISSION_PACKS.map((p) => p.id)).toEqual([
      "operations",
      "dispatch",
      "field-access",
      "financials",
      "reports",
      "price-book",
      "team-management",
      "admin-settings",
    ]);
  });

  it("each pack has a non-empty label and description", () => {
    for (const pack of PERMISSION_PACKS) {
      expect(pack.label.length, `pack=${pack.id}`).toBeGreaterThan(0);
      expect(pack.description.length, `pack=${pack.id}`).toBeGreaterThan(0);
    }
  });

  it("the 7 currently-enforced backend keys are all in the enforced set", () => {
    expect(ENFORCED_PERMISSION_KEYS.has("dashboard.view")).toBe(true);
    expect(ENFORCED_PERMISSION_KEYS.has("jobs.view")).toBe(true);
    expect(ENFORCED_PERMISSION_KEYS.has("clients.view.basic")).toBe(true);
    expect(ENFORCED_PERMISSION_KEYS.has("invoices.view")).toBe(true);
    expect(ENFORCED_PERMISSION_KEYS.has("quotes.view")).toBe(true);
    expect(ENFORCED_PERMISSION_KEYS.has("roles.manage")).toBe(true);
    expect(ENFORCED_PERMISSION_KEYS.has("permissions.manage")).toBe(true);
  });

  it("destructive deletes from §7 of the matrix are flagged Advanced", () => {
    for (const k of [
      "schedule.all.delete",
      "jobs.delete",
      "clients.delete",
      "notes.all.delete",
      "payments.refund",
    ]) {
      expect(ADVANCED_PERMISSION_KEYS.has(k), `expected ${k} in Advanced set`).toBe(true);
    }
  });

  it("isPermissionEnforced + isAdvancedPermission helpers report consistently", () => {
    expect(isPermissionEnforced("dashboard.view")).toBe(true);
    expect(isPermissionEnforced("nonexistent.perm")).toBe(false);
    expect(isAdvancedPermission("payments.refund")).toBe(true);
    expect(isAdvancedPermission("dashboard.view")).toBe(false);
  });

  it("packIdForPermissionKey returns null for unknown keys", () => {
    expect(packIdForPermissionKey("totally.made.up")).toBeNull();
    expect(packIdForPermissionKey("dashboard.view")).toBe("operations");
    expect(packIdForPermissionKey("payments.collect")).toBe("financials");
  });

  it("no permission is in two packs at once (mapping is a partition)", () => {
    const seen = new Map<string, string>();
    for (const pack of PERMISSION_PACKS) {
      for (const key of pack.permissionKeys) {
        if (seen.has(key)) {
          throw new Error(
            `permission "${key}" appears in both ${seen.get(key)} and ${pack.id}`,
          );
        }
        seen.set(key, pack.id);
      }
    }
    expect(seen.size).toBeGreaterThan(0);
  });
});

describe("groupPermissionsByPack — behavior", () => {
  it("buckets permissions into the correct pack with Advanced separation", () => {
    const input = [
      { name: "dashboard.view" }, // operations primary
      { name: "jobs.delete" }, // operations advanced (delete)
      { name: "payments.collect" }, // financials primary
      { name: "payments.refund" }, // financials advanced (refund)
      { name: "totally.unknown.key" }, // unmapped
    ];
    const result = groupPermissionsByPack(input);
    const ops = result.packs.find((p) => p.pack.id === "operations");
    expect(ops?.primary.some((p) => p.name === "dashboard.view")).toBe(true);
    expect(ops?.advanced.some((p) => p.name === "jobs.delete")).toBe(true);
    const fin = result.packs.find((p) => p.pack.id === "financials");
    expect(fin?.primary.some((p) => p.name === "payments.collect")).toBe(true);
    expect(fin?.advanced.some((p) => p.name === "payments.refund")).toBe(true);
    expect(result.unmapped.some((p) => p.name === "totally.unknown.key")).toBe(true);
  });

  it("returns packs in the canonical display order (skipping empty packs)", () => {
    // Only Operations has a key → only Operations should appear.
    const result = groupPermissionsByPack([{ name: "dashboard.view" }]);
    expect(result.packs.map((p) => p.pack.id)).toEqual(["operations"]);
  });
});

// ── Source pins: ManageRoles.tsx ────────────────────────────────────

describe("ManageRoles — system-role lock + clone CTA", () => {
  it("imports the permission-packs grouping helpers", () => {
    expect(manageRolesSrc).toMatch(
      /from\s+["']@\/lib\/permissionPacks["']/,
    );
    expect(manageRolesSrc).toMatch(/groupPermissionsByPack/);
  });

  it("renders a System badge with a Lock icon for system roles in the list", () => {
    expect(manageRolesSrc).toMatch(
      /data-testid=\{`badge-system-role-\$\{role\.name\}`\}/,
    );
    expect(manageRolesSrc).toMatch(/<Lock /);
    expect(manageRolesSrc).toMatch(/System roles are fixed\. Clone to customize\./);
  });

  it("replaces Edit/Delete with the Clone-to-custom-role CTA when a system role is selected", () => {
    expect(manageRolesSrc).toMatch(
      /data-testid="button-clone-system-role"/,
    );
    expect(manageRolesSrc).toMatch(/Clone to custom role/);
    // Edit + Delete still exist for non-system roles, but are conditional
    // on `!isSelectedSystemRole`.
    expect(manageRolesSrc).toMatch(/isSelectedSystemRole/);
  });

  it("reveals the Create custom role button (previously hidden)", () => {
    expect(manageRolesSrc).toMatch(/data-testid="button-create-role"/);
    expect(manageRolesSrc).toMatch(/Create custom role/);
    // The old "Create Role button hidden" comment must be gone.
    expect(manageRolesSrc).not.toMatch(/Create Role button hidden/);
  });

  it("groups permissions by pack (not raw category) in the editor", () => {
    expect(manageRolesSrc).toMatch(/data-testid="role-permission-pack-list"/);
    expect(manageRolesSrc).toMatch(
      /data-testid=\{`pack-trigger-\$\{pack\.id\}`\}/,
    );
  });

  it("renders an Advanced disclosure for noisy / destructive permissions", () => {
    expect(manageRolesSrc).toMatch(
      /data-testid=\{`advanced-trigger-\$\{pack\.id\}`\}/,
    );
  });

  it("preserves the existing role-permission save endpoint and payload shape", () => {
    // PUT /api/roles/:roleId/permissions — flat array of permission keys.
    expect(manageRolesSrc).toMatch(
      /apiRequest\(\s*`\/api\/roles\/\$\{roleId\}\/permissions`,\s*\{\s*method:\s*"PUT"/,
    );
    expect(manageRolesSrc).toMatch(/JSON\.stringify\(\{\s*permissions\s*\}\)/);
  });

  it("preserves the Create role POST endpoint", () => {
    expect(manageRolesSrc).toMatch(
      /apiRequest\("\/api\/roles",\s*\{\s*method:\s*"POST"/,
    );
  });

  it("marks unenforced permissions with the 'Not enforced yet' hint", () => {
    expect(manageRolesSrc).toMatch(/Not enforced yet/);
    expect(manageRolesSrc).toMatch(/isPermissionEnforced/);
  });
});

// ── Source pins: RolesAccessTab.tsx ─────────────────────────────────

describe("RolesAccessTab — pack-driven override editor", () => {
  it("imports the permission-packs grouping helpers", () => {
    expect(rolesAccessSrc).toMatch(
      /from\s+["']@\/lib\/permissionPacks["']/,
    );
    expect(rolesAccessSrc).toMatch(/groupPermissionsByPack/);
  });

  it("renders the per-user override editor grouped by pack", () => {
    expect(rolesAccessSrc).toMatch(/data-testid="override-pack-list"/);
    expect(rolesAccessSrc).toMatch(
      /data-testid=\{`override-pack-trigger-\$\{pack\.id\}`\}/,
    );
  });

  it("preserves the Allow / Deny / Inherited tri-state controls", () => {
    expect(rolesAccessSrc).toMatch(/data-testid=\{`button-perm-inherited-\$\{p\.id\}`\}/);
    expect(rolesAccessSrc).toMatch(/data-testid=\{`button-perm-allow-\$\{p\.id\}`\}/);
    expect(rolesAccessSrc).toMatch(/data-testid=\{`button-perm-deny-\$\{p\.id\}`\}/);
  });

  it("preserves the per-user override save endpoint and payload shape", () => {
    // PUT /api/team/:userId/permissions with { overrides: [{ permissionId, override }] }.
    expect(rolesAccessSrc).toMatch(
      /apiRequest\(\s*`\/api\/team\/\$\{displayedId\}\/permissions`,\s*\{\s*method:\s*"PUT"/,
    );
    expect(rolesAccessSrc).toMatch(/JSON\.stringify\(\{\s*overrides:/);
    // Per-row override object: { permissionId, override }.
    expect(rolesAccessSrc).toMatch(/permissionId:\s*nameToId\[name\]/);
  });

  it("preserves the role assignment save path (PATCH /api/team/:userId)", () => {
    expect(rolesAccessSrc).toMatch(
      /apiRequest\(\s*`\/api\/team\/\$\{displayedId\}`,\s*\{\s*method:\s*"PATCH"/,
    );
  });

  it("marks unenforced permissions in the override editor", () => {
    expect(rolesAccessSrc).toMatch(/Not enforced yet/);
    expect(rolesAccessSrc).toMatch(/isPermissionEnforced/);
  });

  it("renders an Advanced disclosure inside each pack", () => {
    expect(rolesAccessSrc).toMatch(
      /data-testid=\{`override-advanced-trigger-\$\{pack\.id\}`\}/,
    );
  });
});

// ── Backend invariant pins (read-only — no gates added in PR 2) ─────

describe("Backend invariants — PR 2 added no new route gates", () => {
  it("permissionPacks module is the only NEW server-touching surface (file-presence pin)", () => {
    // PR 2 must not have added any new route file or migration.
    // We can't easily inventory those here, but we pin that the
    // pack module references no server route paths inside its
    // declarations — it's a pure UI mapper.
    expect(packsSrc).not.toMatch(/app\.use\(/);
    expect(packsSrc).not.toMatch(/router\.(get|post|put|patch|delete)\(/);
  });
});
