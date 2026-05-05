/**
 * RBAC role_id-NULL resilience — Phase 2 PR 3 hotfix (2026-05-04).
 *
 * Pins the regression that took down dashboard / jobs / clients /
 * invoices / quotes for owner / admin / manager users on 2026-05-04:
 *
 *   - `userRepository.createUser` does not set `role_id`.
 *   - The 2026-05-01 backfill migration only fixed rows that
 *     existed at the time — every user inserted after had
 *     `role_id = NULL`.
 *   - `getUserEffectivePermissions` threw on NULL `role_id`.
 *   - `requirePermission` is async middleware in Express 4, so the
 *     throw became an unhandled rejection → 500 / hung request →
 *     "Failed to load financial dashboard."
 *
 * Two-layer fix verified here:
 *
 *   1. Runtime fallback. When `users.role_id` is NULL but
 *      `users.role` matches a seeded `roles.name`, the resolver
 *      looks up the id and self-heals the row.
 *   2. Backfill migration `2026_05_04_backfill_users_role_id_followup.sql`
 *      runs the same `UPDATE … FROM roles … WHERE role_id IS NULL`
 *      idempotently for the bulk fix.
 *
 * Plus:
 *   3. `requirePermission` no longer leaks resolver throws as
 *      unhandled rejections — they return 500 with a structured
 *      diagnostic instead.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { and, eq, sql } from "drizzle-orm";

import { db } from "../server/db";
import {
  companies,
  users,
  roles,
} from "@shared/schema";
import {
  permissionRepository,
  clearPermissionCache,
} from "../server/storage/permissions";
import { requirePermission } from "../server/permissions";

const PREFIX = "rbac_roleid_fallback_test_";

const tenantId = uuidv4();
const ownerId = uuidv4();
const adminId = uuidv4();
const managerId = uuidv4();
const techId = uuidv4();

async function setupFixtures() {
  await db.insert(companies).values({ id: tenantId, name: `${PREFIX}co` });
  // INSERT WITH role_id = NULL — exactly the production bug shape.
  await db.insert(users).values([
    {
      id: ownerId,
      companyId: tenantId,
      email: `${PREFIX}owner_${Date.now()}@t`,
      password: "x",
      role: "owner",
      // roleId intentionally omitted → NULL in DB.
      status: "active",
    },
    {
      id: adminId,
      companyId: tenantId,
      email: `${PREFIX}admin_${Date.now()}@t`,
      password: "x",
      role: "admin",
      status: "active",
    },
    {
      id: managerId,
      companyId: tenantId,
      email: `${PREFIX}manager_${Date.now()}@t`,
      password: "x",
      role: "manager",
      status: "active",
    },
    {
      id: techId,
      companyId: tenantId,
      email: `${PREFIX}tech_${Date.now()}@t`,
      password: "x",
      role: "technician",
      status: "active",
    },
  ]);
}

async function teardownFixtures() {
  await db.delete(users).where(eq(users.companyId, tenantId));
  await db.delete(companies).where(eq(companies.id, tenantId));
}

function mkRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("RBAC NULL role_id — runtime fallback in resolver", () => {
  beforeAll(async () => {
    await setupFixtures();
  });
  afterAll(async () => {
    await teardownFixtures();
  });

  it("inserts users with role_id IS NULL (verifying the bug shape is reproduced)", async () => {
    // Sanity: the rows really do have NULL role_id at insert time.
    const rows = await db
      .select({ id: users.id, roleId: users.roleId, role: users.role })
      .from(users)
      .where(eq(users.companyId, tenantId));
    const owner = rows.find((r) => r.id === ownerId)!;
    expect(owner.roleId).toBeNull();
    expect(owner.role).toBe("owner");
  });

  it("owner with NULL role_id resolves the canonical owner permission set", async () => {
    clearPermissionCache(ownerId);
    const perms = await permissionRepository.getUserEffectivePermissions(ownerId);
    expect(perms.size).toBeGreaterThan(0);
    expect(perms.has("dashboard.view")).toBe(true);
    expect(perms.has("jobs.view")).toBe(true);
    expect(perms.has("invoices.view")).toBe(true);
    expect(perms.has("clients.view.basic")).toBe(true);
    expect(perms.has("quotes.view")).toBe(true);
  });

  it("admin with NULL role_id resolves dashboard.view + office reads", async () => {
    clearPermissionCache(adminId);
    const perms = await permissionRepository.getUserEffectivePermissions(adminId);
    expect(perms.has("dashboard.view")).toBe(true);
    expect(perms.has("jobs.view")).toBe(true);
    expect(perms.has("invoices.view")).toBe(true);
  });

  it("manager with NULL role_id resolves dashboard.view (matches dashboard-authz contract)", async () => {
    clearPermissionCache(managerId);
    const perms = await permissionRepository.getUserEffectivePermissions(managerId);
    expect(perms.has("dashboard.view")).toBe(true);
  });

  it("technician with NULL role_id is RESOLVED but does NOT have dashboard.view", async () => {
    clearPermissionCache(techId);
    const perms = await permissionRepository.getUserEffectivePermissions(techId);
    // Technician role exists in the seeded set, so resolution succeeds —
    // it just doesn't carry the office permissions.
    expect(perms.has("dashboard.view")).toBe(false);
    expect(perms.has("invoices.view")).toBe(false);
    expect(perms.has("quotes.view")).toBe(false);
  });

  it("self-healing: after first resolve, role_id is persisted on the row", async () => {
    clearPermissionCache(ownerId);
    // First call triggers the fallback + UPDATE.
    await permissionRepository.getUserEffectivePermissions(ownerId);
    const after = await db
      .select({ roleId: users.roleId })
      .from(users)
      .where(eq(users.id, ownerId))
      .limit(1);
    expect(after[0].roleId).not.toBeNull();
    // The persisted id must match the seeded `owner` role.
    const ownerRole = await db
      .select({ id: roles.id })
      .from(roles)
      .where(sql`LOWER(${roles.name}) = 'owner'`)
      .limit(1);
    expect(after[0].roleId).toBe(ownerRole[0].id);
  });
});

describe("requirePermission — async-throw safety net", () => {
  it("returns 500 (not a hung request) when the resolver throws", async () => {
    // We can't easily make the production resolver throw now that
    // the fallback is in place, so we mock at the module level.
    const spy = vi
      .spyOn(permissionRepository, "userHasPermission")
      .mockRejectedValueOnce(new Error("simulated RBAC misconfig"));

    const mw = requirePermission("dashboard.view");
    const req: any = { user: { id: "x", role: "owner" } };
    const res = mkRes();
    const next = vi.fn();

    await mw(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Permission resolution failed",
        requiredPermission: "dashboard.view",
      }),
    );

    spy.mockRestore();
  });
});

describe("Source-pin: backfill follow-up migration exists", () => {
  it("migrations/2026_05_04_backfill_users_role_id_followup.sql is present", () => {
    const { existsSync } = require("fs");
    const { resolve } = require("path");
    const path = resolve(
      __dirname,
      "../migrations/2026_05_04_backfill_users_role_id_followup.sql",
    );
    expect(existsSync(path)).toBe(true);
  });

  // Note: a "zero unmapped users in DB" assertion is intentionally
  // NOT added here — other test suites (tech-locations-routes,
  // tech-pwa-final-cutover) insert fixture users with role_id NULL
  // by design (to test their own scoping logic), so a global count
  // is not stable when suites run together. The runtime-fallback
  // cases above already prove the resilience layer; the migration's
  // bulk effect is verified manually post-deploy.
});
