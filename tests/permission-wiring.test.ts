/**
 * Permission wiring — Phase 2 PR 4 (2026-05-04).
 *
 * Pins the new fine `requirePermission(...)` gates added behind the
 * existing role gates on:
 *   - /api/payments + /api/invoices/:id/payments + Stripe alias
 *   - /api/reports (split: operational vs financial)
 *   - /api/items mutations (catalog edits)
 *   - /api/team reads + writes (excluding role/permission management)
 *   - /api/invitations
 *   - /api/company-settings, /api/company/business-hours,
 *     /api/communication-templates
 *   - /api/qbo (every route)
 *
 * Plus:
 *   - ENFORCED_PERMISSION_KEYS in client/src/lib/permissionPacks.ts
 *     was updated so `getPackAccess` reports `full` for the newly
 *     wired packs when the user has the relevant key.
 *
 * Coverage strategy: source-pin against the route files. We're not
 * spinning up the HTTP layer — every gate is a one-line
 * `requirePermission("...")` insertion that is either present in
 * the source or it is not. A future revert that drops a gate fails
 * loudly here.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

import {
  ENFORCED_PERMISSION_KEYS,
  PERMISSION_PACKS,
  getPackAccess,
} from "../client/src/lib/permissionPacks";

function read(rel: string): string {
  return readFileSync(resolve(__dirname, "..", rel), "utf-8");
}

const paymentsSrc = read("server/routes/payments.ts");
const paymentAccountSrc = read("server/routes/paymentAccount.ts");
const stripePaymentsSrc = read("server/routes/stripePayments.ts");
const reportsSrc = read("server/routes/reports.ts");
const timesheetReportsSrc = read("server/routes/timesheetReports.ts");
const itemsSrc = read("server/routes/items.ts");
const teamSrc = read("server/routes/team.ts");
const invitationsSrc = read("server/routes/invitations.ts");
const companySettingsSrc = read("server/routes/companySettings.ts");
const businessHoursSrc = read("server/routes/businessHours.ts");
const commsTemplatesSrc = read("server/routes/communicationTemplates.ts");
const qboSrc = read("server/routes/qbo.ts");

// ── Payments ─────────────────────────────────────────────────────────

describe("Payments — payments.view + payments.collect wiring", () => {
  it("imports requirePermission in payments.ts", () => {
    expect(paymentsSrc).toMatch(/from\s+["']\.\.\/permissions["']/);
    expect(paymentsSrc).toMatch(/requirePermission/);
  });

  it("GET /invoices/:invoiceId/payments has payments.view", () => {
    expect(paymentsSrc).toMatch(
      /router\.get\(\s*"\/invoices\/:invoiceId\/payments"[\s\S]*?requirePermission\("payments\.view"\)/,
    );
  });

  it("POST /invoices/:invoiceId/payments has payments.collect behind role gate", () => {
    expect(paymentsSrc).toMatch(
      /router\.post\(\s*"\/invoices\/:invoiceId\/payments"\s*,\s*requireRole\(MANAGER_ROLES\),\s*requirePermission\("payments\.collect"\)/,
    );
  });

  it("POST /invoices/:invoiceId/payments/checkout has payments.collect", () => {
    expect(paymentsSrc).toMatch(
      /\/invoices\/:invoiceId\/payments\/checkout"[\s\S]*?requirePermission\("payments\.collect"\)/,
    );
  });

  it("PATCH /payments/:id has payments.collect", () => {
    expect(paymentsSrc).toMatch(
      /router\.patch\(\s*"\/payments\/:id"\s*,\s*requireRole\(MANAGER_ROLES\),\s*requirePermission\("payments\.collect"\)/,
    );
  });

  it("DELETE /payments/:id has payments.collect", () => {
    expect(paymentsSrc).toMatch(
      /router\.delete\(\s*"\/payments\/:id"\s*,\s*requireRole\(MANAGER_ROLES\),\s*requirePermission\("payments\.collect"\)/,
    );
  });

  it("POST /payments/:id/reversal has payments.collect", () => {
    expect(paymentsSrc).toMatch(
      /router\.post\(\s*"\/payments\/:id\/reversal"\s*,\s*requireRole\(MANAGER_ROLES\),\s*requirePermission\("payments\.collect"\)/,
    );
  });

  it("POST /payments/:id/refund is INTENTIONALLY NOT gated by a fine permission", () => {
    // Refunds remain role-fixed (per ACCESS_CONTROL_MATRIX.md §5).
    // Pin the absence of `requirePermission(...)` between the
    // role gate and the asyncHandler for the refund route.
    const refundBlock = paymentsSrc.match(
      /router\.post\(\s*"\/payments\/:id\/refund"[\s\S]*?asyncHandler\(/,
    );
    expect(refundBlock).toBeTruthy();
    expect(refundBlock![0]).not.toMatch(/requirePermission\("payments\.refund"\)/);
    expect(refundBlock![0]).not.toMatch(/requirePermission\("payments\.collect"\)/);
  });
});

describe("Payments dashboard reads — payments.view on financial-data routes", () => {
  it("paymentAccount.ts imports requirePermission", () => {
    expect(paymentAccountSrc).toMatch(/from\s+["']\.\.\/permissions["']/);
  });

  for (const path of [
    "/payments/payouts",
    "/payments/payouts/summary",
    "/payments/disputes",
    "/payments/disputes/summary",
    "/payments/transactions",
    "/payments/anomalies/summary",
  ]) {
    it(`GET ${path} has payments.view behind RESTRICTED_MANAGER_ROLES`, () => {
      const escaped = path.replace(/\//g, "\\/").replace(/\?/g, "\\?");
      const re = new RegExp(
        `router\\.get\\(\\s*"${escaped}"\\s*,\\s*requireRole\\(RESTRICTED_MANAGER_ROLES\\),\\s*requirePermission\\("payments\\.view"\\)`,
      );
      expect(paymentAccountSrc).toMatch(re);
    });
  }

  it("Account setup writes (onboard, refresh) stay ADMIN_ROLES only — no fine permission", () => {
    // Per matrix §5: "payment-provider account onboarding is
    // operationally adjacent to integrations setup and remains
    // role-fixed." No requirePermission added.
    const onboardBlock = paymentAccountSrc.match(
      /router\.post\(\s*"\/payments\/account\/onboard"[\s\S]*?asyncHandler\(/,
    );
    expect(onboardBlock).toBeTruthy();
    expect(onboardBlock![0]).not.toMatch(/requirePermission\(/);
  });
});

describe("Stripe payment alias mirrors payments.collect", () => {
  it("legacy POST /invoices/:invoiceId/stripe/payment-intent has payments.collect", () => {
    expect(stripePaymentsSrc).toMatch(
      /\/invoices\/:invoiceId\/stripe\/payment-intent"\s*,\s*requireRole\(MANAGER_ROLES\),\s*requirePermission\("payments\.collect"\)/,
    );
  });
});

// ── Reports ──────────────────────────────────────────────────────────

describe("Reports — split into operational vs financial", () => {
  it("imports requirePermission in reports.ts", () => {
    expect(reportsSrc).toMatch(/from\s+["']\.\.\/permissions["']/);
  });

  const operational = [
    "/operations",
    "/sales",
    "/jobs",
    "/sales-funnel",
    "/team",
    "/parts-forecast",
    "/action-required-kpis",
  ];
  for (const path of operational) {
    it(`GET ${path} has reports.view.basic`, () => {
      expect(reportsSrc).toMatch(
        new RegExp(
          `"${path.replace(/\//g, "\\/")}"[\\s\\S]{0,200}?requirePermission\\("reports\\.view\\.basic"\\)`,
        ),
      );
    });
  }

  const financial = ["/snapshot", "/financial", "/ar", "/revenue", "/ar-aging"];
  for (const path of financial) {
    it(`GET ${path} has reports.view.financial`, () => {
      expect(reportsSrc).toMatch(
        new RegExp(
          `"${path.replace(/\//g, "\\/")}"[\\s\\S]{0,200}?requirePermission\\("reports\\.view\\.financial"\\)`,
        ),
      );
    });
  }

  it("timesheet GET endpoints have reports.view.basic; payroll-settings PATCH stays role-only", () => {
    expect(timesheetReportsSrc).toMatch(
      /"\/timesheets"[\s\S]{0,200}?requirePermission\("reports\.view\.basic"\)/,
    );
    expect(timesheetReportsSrc).toMatch(
      /"\/timesheets\/payroll-settings"[\s\S]{0,200}?requirePermission\("reports\.view\.basic"\)/,
    );
    // PATCH stays MANAGER_ROLES only — payroll cadence is intentionally
    // not made tenant-customizable in this PR.
    const patchBlock = timesheetReportsSrc.match(
      /timesheetReportsRouter\.patch\(\s*"\/timesheets\/payroll-settings"[\s\S]*?asyncHandler\(/,
    );
    expect(patchBlock).toBeTruthy();
    expect(patchBlock![0]).not.toMatch(/requirePermission\(/);
  });
});

// ── Items / Price book ──────────────────────────────────────────────

describe("Items — pricing.edit on mutations only (reads stay open)", () => {
  it("imports requirePermission in items.ts", () => {
    expect(itemsSrc).toMatch(/from\s+["']\.\.\/permissions["']/);
  });

  it("GET / does NOT have a permission gate (catalog dependency for job/invoice flows)", () => {
    const getBlock = itemsSrc.match(
      /router\.get\("\/"[\s\S]*?asyncHandler\(/,
    );
    expect(getBlock).toBeTruthy();
    expect(getBlock![0]).not.toMatch(/requirePermission\(/);
  });

  it("POST / has pricing.edit", () => {
    expect(itemsSrc).toMatch(
      /router\.post\("\/"\s*,\s*requireRole\(MANAGER_ROLES\),\s*requirePermission\("pricing\.edit"\)/,
    );
  });

  it("PUT /:id has pricing.edit", () => {
    expect(itemsSrc).toMatch(
      /router\.put\("\/:id"\s*,\s*requireRole\(MANAGER_ROLES\),\s*requirePermission\("pricing\.edit"\)/,
    );
  });

  it("DELETE /:id has pricing.edit", () => {
    expect(itemsSrc).toMatch(
      /router\.delete\("\/:id"\s*,\s*requireRole\(MANAGER_ROLES\),\s*requirePermission\("pricing\.edit"\)/,
    );
  });

  it("POST /bulk-delete has pricing.edit", () => {
    expect(itemsSrc).toMatch(
      /router\.post\("\/bulk-delete"\s*,\s*requireRole\(MANAGER_ROLES\),\s*requirePermission\("pricing\.edit"\)/,
    );
  });
});

// ── Team management ──────────────────────────────────────────────────

describe("Team — team.view on reads, team.manage on writes", () => {
  it("imports requirePermission in team.ts", () => {
    expect(teamSrc).toMatch(/from\s+["']\.\.\/permissions["']/);
  });

  it("GET / (team list) has team.view", () => {
    expect(teamSrc).toMatch(
      /router\.get\(\s*"\/"\s*,\s*requirePermission\("team\.view"\)/,
    );
  });

  it("GET /:userId has team.view", () => {
    expect(teamSrc).toMatch(
      /router\.get\(\s*"\/:userId"\s*,\s*requirePermission\("team\.view"\)/,
    );
  });

  it("POST / (create) has team.manage behind role gate", () => {
    expect(teamSrc).toMatch(
      /router\.post\(\s*"\/"\s*,\s*requireRole\(RESTRICTED_MANAGER_ROLES\),[\s\S]{0,500}?requirePermission\("team\.manage"\)/,
    );
  });

  it("PATCH /:userId (basic info) has team.manage", () => {
    expect(teamSrc).toMatch(
      /router\.patch\(\s*"\/:userId"\s*,\s*requireRole\(RESTRICTED_MANAGER_ROLES\),\s*requirePermission\("team\.manage"\)/,
    );
  });

  it("POST /:userId/deactivate has team.manage", () => {
    expect(teamSrc).toMatch(
      /"\/:userId\/deactivate"\s*,\s*requireRole\(RESTRICTED_MANAGER_ROLES\),\s*requirePermission\("team\.manage"\)/,
    );
  });

  it("PUT /:userId/profile has team.manage", () => {
    expect(teamSrc).toMatch(
      /"\/:userId\/profile"\s*,\s*requireRole\(RESTRICTED_MANAGER_ROLES\),\s*requirePermission\("team\.manage"\)/,
    );
  });

  it("PUT /:userId/working-hours has team.manage", () => {
    expect(teamSrc).toMatch(
      /"\/:userId\/working-hours"\s*,\s*requireRole\(RESTRICTED_MANAGER_ROLES\),\s*requirePermission\("team\.manage"\)/,
    );
  });

  it("PATCH /:userId/role STAYS on owner/admin role gate (NOT team.manage)", () => {
    // Role-assignment paths use their own owner/admin gate per matrix §5.
    const block = teamSrc.match(
      /router\.patch\(\s*"\/:userId\/role"[\s\S]*?asyncHandler\(/,
    );
    expect(block).toBeTruthy();
    expect(block![0]).not.toMatch(/requirePermission\("team\.manage"\)/);
    expect(block![0]).toMatch(/requireRole\(\["owner",\s*"admin"\]\)/);
  });

  it("PUT /:userId/permissions (legacy bulk) gets permissions.manage (NOT team.manage)", () => {
    expect(teamSrc).toMatch(
      /router\.put\(\s*"\/:userId\/permissions"\s*,\s*requireRole\(RESTRICTED_MANAGER_ROLES\),\s*requirePermission\("permissions\.manage"\)/,
    );
  });
});

describe("Invitations — team.manage on create/resend, accept stays public", () => {
  it("POST / has team.manage", () => {
    expect(invitationsSrc).toMatch(
      /router\.post\("\/"\s*,\s*requireRole\(\["admin",\s*"dispatcher"\]\),\s*requirePermission\("team\.manage"\)/,
    );
  });

  it("POST /:id/resend has team.manage", () => {
    expect(invitationsSrc).toMatch(
      /router\.post\("\/:id\/resend"\s*,\s*requireRole\(\["admin",\s*"dispatcher"\]\),\s*requirePermission\("team\.manage"\)/,
    );
  });

  it("POST /accept stays public (no requirePermission, no requireRole)", () => {
    const block = invitationsSrc.match(
      /router\.post\("\/accept"[\s\S]*?asyncHandler\(/,
    );
    expect(block).toBeTruthy();
    expect(block![0]).not.toMatch(/requirePermission\(/);
    expect(block![0]).not.toMatch(/requireRole\(/);
  });
});

// ── Settings + Integrations ─────────────────────────────────────────

describe("Settings — settings.manage on writes (reads stay open)", () => {
  it("companySettings PUT has settings.manage", () => {
    expect(companySettingsSrc).toMatch(
      /router\.put\("\/"\s*,\s*requireRole\(RESTRICTED_MANAGER_ROLES\)\s*,\s*requirePermission\("settings\.manage"\)/,
    );
  });

  it("companySettings POST has settings.manage", () => {
    expect(companySettingsSrc).toMatch(
      /router\.post\("\/"\s*,\s*requireRole\(RESTRICTED_MANAGER_ROLES\)\s*,\s*requirePermission\("settings\.manage"\)/,
    );
  });

  it("businessHours PUT has settings.manage", () => {
    expect(businessHoursSrc).toMatch(
      /router\.put\(\s*"\/"\s*,\s*requireRole\(RESTRICTED_MANAGER_ROLES\),\s*requirePermission\("settings\.manage"\)/,
    );
  });

  it("communicationTemplates: every route has settings.manage behind RESTRICTED_MANAGER_ROLES", () => {
    const matches = commsTemplatesSrc.match(
      /requireRole\(RESTRICTED_MANAGER_ROLES\),\s*requirePermission\("settings\.manage"\)/g,
    );
    // 5 routes (GET /:entityType/:channel, POST /preview/:entityType,
    // POST /, PUT /, DELETE /:entityType/:channel).
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(5);
  });
});

describe("QBO — integrations.manage on every gated route", () => {
  it("imports requirePermission in qbo.ts", () => {
    expect(qboSrc).toMatch(/from\s+["']\.\.\/permissions["']/);
  });

  it("every requireRole(ADMIN_ROLES) is followed by integrations.manage", () => {
    // Count occurrences. Every admin-role gate in this file must be
    // paired with the integrations.manage fine permission.
    const adminGates =
      qboSrc.match(/requireRole\(ADMIN_ROLES\),\s*requirePermission\("integrations\.manage"\)/g) ??
      [];
    const orphanGates =
      qboSrc.match(/requireRole\(ADMIN_ROLES\),\s*asyncHandler\(/g) ?? [];
    expect(orphanGates.length).toBe(0);
    expect(adminGates.length).toBeGreaterThanOrEqual(50);
  });
});

describe("Imports — intentionally unchanged in PR 4", () => {
  it("imports.ts is NOT gated by a fine permission (still owner/admin only)", () => {
    const importsSrc = read("server/routes/imports.ts");
    // Per ACCESS_CONTROL_MATRIX.md §5, imports stay role-fixed
    // (owner/admin only) — destructive bulk operations.
    expect(importsSrc).not.toMatch(/requirePermission\("settings\.manage"\)/);
    expect(importsSrc).not.toMatch(/requirePermission\("integrations\.manage"\)/);
  });
});

// ── Effective Access Preview rollup ─────────────────────────────────

describe("ENFORCED_PERMISSION_KEYS reflects PR 4 wiring", () => {
  it("includes the 9 newly-enforced keys", () => {
    for (const k of [
      "payments.view",
      "payments.collect",
      "reports.view.basic",
      "reports.view.financial",
      "pricing.edit",
      "team.view",
      "team.manage",
      "settings.manage",
      "integrations.manage",
    ]) {
      expect(ENFORCED_PERMISSION_KEYS.has(k), `expected ${k} in enforced set`).toBe(
        true,
      );
    }
  });

  it("Financials pack now reaches `full` with payments.view alone", () => {
    const { byPackId } = getPackAccess(["payments.view"]);
    expect(byPackId.financials.status).toBe("full");
    expect(byPackId.financials.hasEnforcedAccess).toBe(true);
  });

  it("Reports pack reaches `full` with reports.view.basic alone", () => {
    const { byPackId } = getPackAccess(["reports.view.basic"]);
    expect(byPackId.reports.status).toBe("full");
  });

  it("Reports pack ALSO reaches `full` with reports.view.financial alone", () => {
    const { byPackId } = getPackAccess(["reports.view.financial"]);
    expect(byPackId.reports.status).toBe("full");
  });

  it("Price Book pack reaches `full` with pricing.edit", () => {
    const { byPackId } = getPackAccess(["pricing.edit"]);
    expect(byPackId["price-book"].status).toBe("full");
  });

  it("Team Management pack reaches `full` with team.view alone", () => {
    const { byPackId } = getPackAccess(["team.view"]);
    expect(byPackId["team-management"].status).toBe("full");
  });

  it("Admin/Settings pack reaches `full` with settings.manage", () => {
    const { byPackId } = getPackAccess(["settings.manage"]);
    expect(byPackId["admin-settings"].status).toBe("full");
  });
});
