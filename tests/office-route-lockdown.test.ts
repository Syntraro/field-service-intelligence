/**
 * Office route lockdown — Phase 2 PR 4 (2026-05-04).
 *
 * Pins the mount-level `requireRole(MANAGER_ROLES)` gates added to:
 *   /api/jobs
 *   /api/clients
 *   /api/equipment
 *   /api/suppliers
 *
 * Final access matrix on these surfaces:
 *   owner / admin / manager / dispatcher → allowed (role gate passes,
 *     fine-permission gate where present passes by RBAC seed)
 *   technician → 403 from the role gate (no DB read needed)
 *
 * What this PR does NOT change (verified by sibling pins):
 *   - /api/dashboard, /api/invoices, /api/quotes still use their
 *     existing fine-permission gates (Phase 1).
 *   - /api/leads keeps the method-scoped GET-only role gate so the
 *     tech-app POST flow remains open.
 *   - All tech surfaces (`/api/tech/*`) untouched — verified by
 *     re-running the existing tech-pwa-final-cutover suite.
 *
 * Two layers of testing:
 *
 *   1. Source-pin against `server/routes/index.ts` so a future edit
 *      that drops a gate fails this test loudly rather than silently
 *      re-opening an office surface.
 *
 *   2. Middleware behavior — direct invocation of `requireRole` with
 *      a fake req/res so we know the wired middleware actually returns
 *      403 for a technician role.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

import { requireRole } from "../server/auth/requireRole";
import { MANAGER_ROLES } from "../server/auth/roles";

const indexSrc = readFileSync(
  resolve(__dirname, "../server/routes/index.ts"),
  "utf-8",
);

// ── Source-pin: mount-level role gates ───────────────────────────────

describe("Backend wiring — office surfaces gated by MANAGER_ROLES", () => {
  it("/api/jobs has requireRole(MANAGER_ROLES) at the mount level", () => {
    expect(indexSrc).toMatch(
      /app\.use\(\s*["']\/api\/jobs["']\s*,\s*requireRole\(\s*MANAGER_ROLES\s*\)\s*\)/,
    );
  });

  it("/api/jobs role gate is declared BEFORE the fine-permission gate", () => {
    const roleIdx = indexSrc.indexOf(
      'app.use("/api/jobs", requireRole(MANAGER_ROLES))',
    );
    const permIdx = indexSrc.indexOf(
      'app.use("/api/jobs", requirePermission("jobs.view"))',
    );
    expect(roleIdx).toBeGreaterThan(0);
    expect(permIdx).toBeGreaterThan(0);
    expect(roleIdx).toBeLessThan(permIdx);
  });

  it("/api/clients has requireRole(MANAGER_ROLES) at the mount level", () => {
    expect(indexSrc).toMatch(
      /app\.use\(\s*["']\/api\/clients["']\s*,\s*requireRole\(\s*MANAGER_ROLES\s*\)\s*\)/,
    );
  });

  it("/api/clients role gate is declared BEFORE the fine-permission gate", () => {
    const roleIdx = indexSrc.indexOf(
      'app.use("/api/clients", requireRole(MANAGER_ROLES))',
    );
    const permIdx = indexSrc.indexOf(
      'app.use("/api/clients", requirePermission("clients.view.basic")',
    );
    expect(roleIdx).toBeGreaterThan(0);
    expect(permIdx).toBeGreaterThan(0);
    expect(roleIdx).toBeLessThan(permIdx);
  });

  it("/api/equipment has requireRole(MANAGER_ROLES) at the mount level", () => {
    expect(indexSrc).toMatch(
      /app\.use\(\s*["']\/api\/equipment["']\s*,\s*requireRole\(\s*MANAGER_ROLES\s*\)\s*\)/,
    );
  });

  it("/api/equipment role gate is declared BEFORE equipmentRouter mount", () => {
    const roleIdx = indexSrc.indexOf(
      'app.use("/api/equipment", requireRole(MANAGER_ROLES))',
    );
    const routerIdx = indexSrc.indexOf(
      'app.use("/api/equipment", equipmentRouter)',
    );
    expect(roleIdx).toBeGreaterThan(0);
    expect(routerIdx).toBeGreaterThan(0);
    expect(roleIdx).toBeLessThan(routerIdx);
  });

  it("/api/suppliers has requireRole(MANAGER_ROLES) at the mount level", () => {
    expect(indexSrc).toMatch(
      /app\.use\(\s*["']\/api\/suppliers["']\s*,\s*requireRole\(\s*MANAGER_ROLES\s*\)\s*\)/,
    );
  });

  it("/api/suppliers role gate is declared BEFORE suppliersRouter mount", () => {
    const roleIdx = indexSrc.indexOf(
      'app.use("/api/suppliers", requireRole(MANAGER_ROLES))',
    );
    const routerIdx = indexSrc.indexOf(
      'app.use("/api/suppliers", suppliersRouter)',
    );
    expect(roleIdx).toBeGreaterThan(0);
    expect(routerIdx).toBeGreaterThan(0);
    expect(roleIdx).toBeLessThan(routerIdx);
  });
});

// ── Source-pin: tech surface untouched ──────────────────────────────

describe("Backend wiring — tech surface NOT gated by MANAGER_ROLES", () => {
  it("/api/tech mount has no MANAGER_ROLES wrapper added by this PR", () => {
    // The tech surface must continue to use `requireSchedulable`
    // (any tenant role with isSchedulable !== false). Adding a
    // MANAGER_ROLES gate would lock technicians out of their own
    // app — explicitly out of scope.
    expect(indexSrc).not.toMatch(
      /app\.use\(\s*["']\/api\/tech["']\s*,\s*requireRole\(/,
    );
  });

  it("/api/leads keeps its method-scoped guard (POST stays open for tech)", () => {
    // Re-pin from dashboard-authz.test.ts so a future edit that
    // tightens leads to a blanket role gate — which would break
    // the tech-app lead-create flow — fails loudly here too.
    expect(indexSrc).toMatch(
      /app\.use\(\s*["']\/api\/leads["']\s*,[\s\S]*?req\.method\s*===\s*["']GET["'][\s\S]*?requireRole\(\s*MANAGER_ROLES\s*\)/,
    );
  });
});

// ── Middleware behavior — requireRole(MANAGER_ROLES) ─────────────────

function mkRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("requireRole(MANAGER_ROLES) middleware behaviour", () => {
  it("returns 403 for a technician (the role this PR closes out)", () => {
    const mw = requireRole(MANAGER_ROLES);
    const req: any = { user: { id: "u", role: "technician" } };
    const res = mkRes();
    const next = vi.fn();
    mw(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() for owner / admin / manager / dispatcher", () => {
    for (const role of ["owner", "admin", "manager", "dispatcher"]) {
      const mw = requireRole(MANAGER_ROLES);
      const req: any = { user: { id: "u", role } };
      const res = mkRes();
      const next = vi.fn();
      mw(req, res, next);
      expect(next, `role=${role} should pass`).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    }
  });

  it("returns 403 for an unauthenticated request (no req.user)", () => {
    const mw = requireRole(MANAGER_ROLES);
    const req: any = { user: null };
    const res = mkRes();
    const next = vi.fn();
    mw(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
