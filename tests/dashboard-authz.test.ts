/**
 * Dashboard Authorization — backend gate enforcement (2026-05-04).
 *
 * Pins the security fix landed alongside this file:
 *   • New permission `dashboard.view` (migration
 *     `2026_05_04_dashboard_view_permission.sql`) granted to
 *     owner / admin / manager only.
 *   • `requirePermission("dashboard.view")` mounted on
 *     `/api/dashboard` so the API surface is authoritative.
 *   • `requirePermission(...)` mounted on `/api/jobs`,
 *     `/api/invoices`, `/api/clients`, `/api/quotes` —
 *     each scoped to the matching catalog permission so
 *     existing tech-PWA reads continue working where the
 *     catalog grants them.
 *   • Method-scoped role gate on `/api/leads` GETs (POST stays
 *     open for the tech-app lead-create flow).
 *   • Frontend `/` and `/financials` switched from
 *     `requireAdmin` to `requireRestrictedManager` so manager
 *     users land on the dashboard instead of being bounced.
 *
 * Two layers of testing:
 *
 *   1. Middleware behaviour — `requirePermission` returns the
 *      expected 401/403/200 shapes for unauthenticated /
 *      lacks-permission / has-permission cases. Pure unit test
 *      with a mocked permission repository.
 *
 *   2. Wiring pins — source-level grep against
 *      `server/routes/index.ts` and `client/src/App.tsx` so a
 *      future edit that drops the gate fails this test loudly
 *      rather than silently re-opening the dashboard API.
 *
 *   3. DB-state pins — live read against `permissions` /
 *      `roles` / `role_permissions` confirms the migration
 *      seeded `dashboard.view` and granted it to exactly
 *      `owner`, `admin`, `manager`.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ── Source-level wiring pins ─────────────────────────────────────────

const indexSrc = readFileSync(
  resolve(__dirname, "../server/routes/index.ts"),
  "utf-8",
);
const appSrc = readFileSync(
  resolve(__dirname, "../client/src/App.tsx"),
  "utf-8",
);

describe("Backend wiring — /api/dashboard is gated by requirePermission('dashboard.view')", () => {
  it("imports requirePermission and mounts it on dashboardRouter", () => {
    expect(indexSrc).toMatch(
      /import\s+\{\s*requirePermission\s*\}\s+from\s+["']\.\.\/permissions["']/,
    );
    expect(indexSrc).toMatch(
      /app\.use\(\s*["']\/api\/dashboard["']\s*,\s*requirePermission\(\s*["']dashboard\.view["']\s*\)\s*,\s*dashboardRouter\s*\)/,
    );
  });
});

describe("Backend wiring — office reads gated by their canonical fine permission", () => {
  it("gates /api/jobs with requirePermission('jobs.view') (mount-level, before sub-routers)", () => {
    expect(indexSrc).toMatch(
      /app\.use\(\s*["']\/api\/jobs["']\s*,\s*requirePermission\(\s*["']jobs\.view["']\s*\)\s*\)/,
    );
  });
  it("gates /api/invoices with requirePermission('invoices.view')", () => {
    expect(indexSrc).toMatch(
      /app\.use\(\s*["']\/api\/invoices["']\s*,\s*requirePermission\(\s*["']invoices\.view["']\s*\)\s*,\s*invoicesRouter\s*\)/,
    );
  });
  it("gates /api/clients with requirePermission('clients.view.basic')", () => {
    expect(indexSrc).toMatch(
      /app\.use\(\s*["']\/api\/clients["']\s*,\s*requirePermission\(\s*["']clients\.view\.basic["']\s*\)\s*,\s*clientsRouter\s*\)/,
    );
  });
  it("gates /api/quotes with requirePermission('quotes.view')", () => {
    expect(indexSrc).toMatch(
      /app\.use\(\s*["']\/api\/quotes["']\s*,\s*requirePermission\(\s*["']quotes\.view["']\s*\)\s*,\s*quotesRouter\s*\)/,
    );
  });
});

describe("Backend wiring — /api/leads GETs gated by MANAGER_ROLES, mutations open", () => {
  it("uses a method-scoped guard so GET requires MANAGER_ROLES but POST/PATCH/DELETE pass through to the router", () => {
    // The shape we ship is a small inline middleware that delegates to
    // requireRole(MANAGER_ROLES) only when req.method === "GET".
    expect(indexSrc).toMatch(
      /app\.use\(\s*["']\/api\/leads["']\s*,[\s\S]*?req\.method\s*===\s*["']GET["'][\s\S]*?requireRole\(\s*MANAGER_ROLES\s*\)/,
    );
  });
});

describe("Frontend wiring — `/` dashboard guard now allows manager", () => {
  it("`/` route uses <ProtectedRoute requireRestrictedManager>", () => {
    expect(appSrc).toMatch(
      /Route path="\/">\s*<ProtectedRoute requireRestrictedManager>\s*<FinancialDashboard \/>/,
    );
  });
  it("`/financials` alias also uses requireRestrictedManager", () => {
    expect(appSrc).toMatch(
      /Route path="\/financials">\s*<ProtectedRoute requireRestrictedManager>\s*<FinancialDashboard \/>/,
    );
  });
});

// ── Middleware behavior — direct invocation with mocked repo ─────────

vi.mock("../server/storage/permissions", () => ({
  permissionRepository: {
    getUserEffectivePermissions: vi.fn(),
    userHasPermission: vi.fn(),
  },
  clearPermissionCache: vi.fn(),
}));

import { requirePermission } from "../server/permissions";
import { permissionRepository } from "../server/storage/permissions";

function mkRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("requirePermission('dashboard.view') middleware behaviour", () => {
  it("returns 401 for an unauthenticated request (no req.user)", async () => {
    const mw = requirePermission("dashboard.view");
    const req: any = { user: null };
    const res = mkRes();
    const next = vi.fn();
    await mw(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when the user lacks dashboard.view (e.g. technician)", async () => {
    (permissionRepository.userHasPermission as any).mockResolvedValueOnce(false);
    const mw = requirePermission("dashboard.view");
    const req: any = { user: { id: "tech-user-1", role: "technician" } };
    const res = mkRes();
    const next = vi.fn();
    await mw(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
    // The error body must reference the required permission so callers
    // can see WHY they were denied (helps debugging without exposing
    // the user's full permission set).
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ requiredPermission: "dashboard.view" }),
    );
  });

  it("calls next() when the user has dashboard.view (e.g. manager)", async () => {
    (permissionRepository.userHasPermission as any).mockResolvedValueOnce(true);
    const mw = requirePermission("dashboard.view");
    const req: any = { user: { id: "manager-user-1", role: "manager" } };
    const res = mkRes();
    const next = vi.fn();
    await mw(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});

// ── DB state — migration outcome ─────────────────────────────────────
//
// Confirms the migration's intent landed in the database. If a
// future migration silently revokes `dashboard.view` from manager,
// or grants it to dispatcher/technician, this test fires.

describe("dashboard.view DB state (migration outcome)", () => {
  it("dashboard.view exists and is granted exactly to owner / admin / manager", async () => {
    // Local imports so the file-level vi.mock above (which mocks a
    // DIFFERENT module) does not interfere.
    const { db } = await import("../server/db");
    const { sql } = await import("drizzle-orm");

    const result = await db.execute(sql`
      SELECT r.name AS role
      FROM permissions p
      JOIN role_permissions rp ON rp.permission_id = p.id
      JOIN roles r ON r.id = rp.role_id
      WHERE p.key = 'dashboard.view'
      ORDER BY r.name
    `);
    const rows = (result as any).rows ?? result;
    const roles = rows.map((r: any) => r.role).sort();

    expect(roles).toEqual(["admin", "manager", "owner"]);
  });

  it("dashboard.view is NOT granted to dispatcher or technician", async () => {
    const { db } = await import("../server/db");
    const { sql } = await import("drizzle-orm");

    const result = await db.execute(sql`
      SELECT r.name AS role
      FROM permissions p
      JOIN role_permissions rp ON rp.permission_id = p.id
      JOIN roles r ON r.id = rp.role_id
      WHERE p.key = 'dashboard.view'
        AND r.name IN ('dispatcher', 'technician')
    `);
    const rows = (result as any).rows ?? result;
    expect(rows).toEqual([]);
  });
});
