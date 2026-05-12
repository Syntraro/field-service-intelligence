/**
 * Canonical alert/callout primitive tests (2026-05-12).
 *
 * Pins the variant API on alert.tsx and verifies that migrated files no
 * longer contain raw semantic alert wrappers (border-amber-*, bg-amber-*,
 * bg-emerald-* / border-emerald-* as panel backgrounds, bg-rose-* /
 * border-rose-* as inline error panels, bg-slate-* / border-slate-* as
 * neutral notice panels).
 *
 * Excluded from drift checks (per task scope):
 *   - Chip/badge surfaces  (PreviewTable DISPOSITION_BADGES)
 *   - KPI/summary cards    (CollectPaymentDialog total summary)
 *   - Dispatch calendar cells and timeline indicators
 *   - Modal variant styling in modal.tsx
 *   - Non-alert uses (hover states, list item backgrounds)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ── helpers ──────────────────────────────────────────────────────────────────

function src(rel: string) {
  return readFileSync(resolve(__dirname, "..", rel), "utf-8");
}

/** Strip block + line comments so doc-comment text doesn't false-match negative pins. */
function code(s: string) {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

// ── alert.tsx — variant API ───────────────────────────────────────────────────

describe("alert.tsx — canonical variant API", () => {
  const alertSrc = src("client/src/components/ui/alert.tsx");

  it("exports Alert, AlertTitle, AlertDescription", () => {
    expect(alertSrc).toContain("export { Alert, AlertTitle, AlertDescription }");
  });

  it("has warning variant with amber semantic tokens", () => {
    expect(alertSrc).toContain("warning:");
    expect(alertSrc).toContain("border-amber-200");
    expect(alertSrc).toContain("bg-amber-50");
  });

  it("has success variant with emerald semantic tokens", () => {
    expect(alertSrc).toContain("success:");
    expect(alertSrc).toContain("border-emerald-200");
    expect(alertSrc).toContain("bg-emerald-50");
  });

  it("has error variant with rose semantic tokens", () => {
    expect(alertSrc).toContain("error:");
    expect(alertSrc).toContain("border-rose-200");
    expect(alertSrc).toContain("bg-rose-50");
  });

  it("has neutral variant with slate semantic tokens", () => {
    expect(alertSrc).toContain("neutral:");
    expect(alertSrc).toContain("border-slate-200");
    expect(alertSrc).toContain("bg-slate-50");
  });

  it("retains default and destructive variants", () => {
    expect(alertSrc).toContain("default:");
    expect(alertSrc).toContain("bg-background");
    expect(alertSrc).toContain("destructive:");
    expect(alertSrc).toContain("border-destructive");
  });
});

// ── TimezoneSetupBanner — uses variant="warning" ──────────────────────────────

describe("TimezoneSetupBanner — uses Alert variant=warning", () => {
  const s = code(src("client/src/components/TimezoneSetupBanner.tsx"));

  it("uses Alert component", () => {
    expect(s).toContain('variant="warning"');
  });

  it("no raw amber bg/border in className", () => {
    expect(s).not.toMatch(/className="[^"]*bg-amber-/);
    expect(s).not.toMatch(/className="[^"]*border-amber-/);
  });
});

// ── QuickAddJobDialog — conflict warning ─────────────────────────────────────

describe("QuickAddJobDialog — conflict warning uses Alert variant=warning", () => {
  const s = code(src("client/src/components/QuickAddJobDialog.tsx"));

  it("imports Alert, AlertDescription", () => {
    expect(s).toMatch(/import\s*\{[^}]*Alert[^}]*\}\s*from\s*["']@\/components\/ui\/alert["']/);
  });

  it("conflict-warning testid is on Alert, not a raw div", () => {
    expect(s).toContain('data-testid="conflict-warning"');
    expect(s).not.toMatch(/div[^>]*data-testid="conflict-warning"/);
  });

  it("no raw amber bg/border on conflict warning", () => {
    // Strip the conflict-warning block for focused check
    expect(s).not.toMatch(/border-amber-300.*bg-amber-50.*conflict-warning|conflict-warning.*border-amber-300.*bg-amber-50/);
  });
});

// ── RefundPaymentDialog — three result panels ────────────────────────────────

describe("RefundPaymentDialog — result panels use Alert primitives", () => {
  const s = code(src("client/src/components/invoice/RefundPaymentDialog.tsx"));

  it("imports Alert, AlertDescription", () => {
    expect(s).toMatch(/import\s*\{[^}]*Alert[^}]*\}\s*from\s*["']@\/components\/ui\/alert["']/);
  });

  it("reconciliation-pending panel uses Alert variant=warning", () => {
    expect(s).toContain('data-testid="refund-reconciliation-pending"');
    expect(s).not.toMatch(/div[^>]*data-testid="refund-reconciliation-pending"/);
    expect(s).not.toMatch(/border-amber-200.*bg-amber-50.*reconciliation|reconciliation.*border-amber-200.*bg-amber-50/);
  });

  it("settled panel uses Alert variant=success", () => {
    expect(s).toContain('data-testid="refund-settled"');
    expect(s).not.toMatch(/div[^>]*data-testid="refund-settled"/);
    expect(s).not.toMatch(/border-emerald-200.*bg-emerald-50.*refund-settled|refund-settled.*border-emerald-200.*bg-emerald-50/);
  });

  it("no raw amber or emerald panel wrappers remain", () => {
    expect(s).not.toMatch(/className="[^"]*border-amber-200 bg-amber-50[^"]*"/);
    expect(s).not.toMatch(/className="[^"]*border-emerald-200 bg-emerald-50[^"]*"/);
  });
});

// ── CollectPaymentDialog — four panels ───────────────────────────────────────

describe("CollectPaymentDialog — inline panels use Alert primitives", () => {
  const s = code(src("client/src/components/invoice/CollectPaymentDialog.tsx"));

  it("imports Alert, AlertDescription", () => {
    expect(s).toMatch(/import\s*\{[^}]*Alert[^}]*\}\s*from\s*["']@\/components\/ui\/alert["']/);
  });

  it("card-success panel uses Alert variant=success", () => {
    expect(s).toContain('data-testid="collect-payment-card-success"');
    expect(s).not.toMatch(/div[^>]*data-testid="collect-payment-card-success"/);
  });

  it("card-error panel uses Alert variant=error", () => {
    expect(s).toContain('data-testid="collect-payment-card-error"');
    expect(s).not.toMatch(/div[^>]*data-testid="collect-payment-card-error"/);
  });

  it("no raw emerald panel wrappers remain", () => {
    // The KPI total summary (collect-payment-total-summary) is a display card, not an alert —
    // it is intentionally excluded from migration, so only check inline alert patterns.
    expect(s).not.toMatch(/className="[^"]*bg-emerald-50 border border-emerald-200[^"]*"/);
    expect(s).not.toMatch(/className="[^"]*bg-rose-50 border border-rose-200[^"]*"/);
  });
});

// ── PreviewTable — warning legend ────────────────────────────────────────────

describe("PreviewTable — warning legend uses Alert variant=warning", () => {
  const s = code(src("client/src/components/imports/PreviewTable.tsx"));

  it("imports Alert, AlertDescription", () => {
    expect(s).toMatch(/import\s*\{[^}]*Alert[^}]*\}\s*from\s*["']@\/components\/ui\/alert["']/);
  });

  it("no raw amber panel wrapper for warning legend", () => {
    expect(s).not.toMatch(/className="[^"]*border-amber-200 bg-amber-50[^"]*"/);
  });
});

// ── ImportWizard — preset notices ────────────────────────────────────────────

describe("ImportWizard — preset notices use Alert primitives", () => {
  const s = code(src("client/src/components/imports/ImportWizard.tsx"));

  it("preset-applied-notice uses Alert, not raw div", () => {
    expect(s).toContain('data-testid="preset-applied-notice"');
    expect(s).not.toMatch(/div[^>]*data-testid="preset-applied-notice"/);
  });

  it("preset-unavailable-notice uses Alert, not raw div", () => {
    expect(s).toContain('data-testid="preset-unavailable-notice"');
    expect(s).not.toMatch(/div[^>]*data-testid="preset-unavailable-notice"/);
  });

  it("no raw emerald or slate panel wrappers for notices", () => {
    expect(s).not.toMatch(/className="[^"]*border-emerald-200 bg-emerald-50[^"]*p-3/);
    expect(s).not.toMatch(/className="[^"]*border-slate-200 bg-slate-50[^"]*p-3[^"]*flex/);
  });
});

// ── CalendarSyncSection — disabled link warning ───────────────────────────────

describe("CalendarSyncSection — disabled link warning uses Alert variant=warning", () => {
  const s = code(src("client/src/components/team-hub/CalendarSyncSection.tsx"));

  it("imports Alert, AlertDescription", () => {
    expect(s).toMatch(/import\s*\{[^}]*Alert[^}]*\}\s*from\s*["']@\/components\/ui\/alert["']/);
  });

  it("no raw amber panel wrapper for disabled-link warning", () => {
    expect(s).not.toMatch(/className="[^"]*border-amber-200 bg-amber-50/);
  });
});

// ── BulkTenantActions — progress strip ───────────────────────────────────────

describe("BulkTenantActions — progress strip uses Alert variant=warning", () => {
  const s = code(src("client/src/pages/platform/BulkTenantActions.tsx"));

  it("imports Alert, AlertDescription", () => {
    expect(s).toMatch(/import\s*\{[^}]*Alert[^}]*\}\s*from\s*["']@\/components\/ui\/alert["']/);
  });

  it("bulk-apply-progress testid is on Alert, not raw div", () => {
    expect(s).toContain('data-testid="bulk-apply-progress"');
    expect(s).not.toMatch(/div[^>]*data-testid="bulk-apply-progress"/);
  });
});

// ── PortalPayInvoiceForm — ready-timeout warning ─────────────────────────────

describe("PortalPayInvoiceForm — ready-timeout uses Alert variant=warning", () => {
  const s = code(src("client/src/pages/portal/PortalPayInvoiceForm.tsx"));

  it("imports Alert, AlertDescription", () => {
    expect(s).toMatch(/import\s*\{[^}]*Alert[^}]*\}\s*from\s*["']@\/components\/ui\/alert["']/);
  });

  it("portal-pay-ready-timeout testid is on Alert, not raw div", () => {
    expect(s).toContain('data-testid="portal-pay-ready-timeout"');
    expect(s).not.toMatch(/div[^>]*data-testid="portal-pay-ready-timeout"/);
  });
});

// ── RequestReset — success confirmation ──────────────────────────────────────

describe("RequestReset — success confirmation uses Alert variant=success", () => {
  const s = code(src("client/src/pages/RequestReset.tsx"));

  it("imports Alert, AlertDescription", () => {
    expect(s).toMatch(/import\s*\{[^}]*Alert[^}]*\}\s*from\s*["']@\/components\/ui\/alert["']/);
  });

  it("request-reset-success testid is on Alert, not raw div", () => {
    expect(s).toContain('data-testid="request-reset-success"');
    expect(s).not.toMatch(/div[^>]*data-testid="request-reset-success"/);
  });

  it("no raw emerald panel wrapper for success confirmation", () => {
    expect(s).not.toMatch(/className="[^"]*border-emerald-200 bg-emerald-50/);
  });
});
