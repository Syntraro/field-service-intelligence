/**
 * Maintenance → Service Plans — sidebar/menu destination rename
 * (2026-05-07).
 *
 * The destination at `/pm` is now labeled "Service Plans" everywhere
 * the user reads it as a navigation target. The data model, the
 * route, the API surface, the jobType="maintenance" enum, and the
 * in-page recurrence-behavior copy (Make Recurring, Recurring schedule,
 * "Recurring Job Created" toasts, etc.) intentionally remain — those
 * describe behavior, not the destination name.
 *
 * History
 * -------
 * - 2026-05-06 first rename: "Recurring Jobs" → "Maintenance".
 * - 2026-05-07 second rename: "Maintenance" → "Service Plans" (this file).
 *
 * This file is a source-pin regression: if a future refactor
 * accidentally replaces "recurring" globally, reverts the destination
 * labels, OR drifts back to "Maintenance" as a destination, these
 * assertions fail.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// Nav item definitions moved to tenantNavConfig.ts (2026-05-14) so that both
// AppSidebar and AppTopNav render from one canonical source. Test assertions
// about nav structure now read from navConfigSrc; AppSidebar is verified only
// for what it still owns (the component wrapper itself, not the item literals).
const sidebarSrc = readFileSync(
  resolve(__dirname, "../client/src/components/AppSidebar.tsx"),
  "utf-8",
);
const navConfigSrc = readFileSync(
  resolve(__dirname, "../client/src/lib/tenantNavConfig.ts"),
  "utf-8",
);
const createMenuSrc = readFileSync(
  resolve(__dirname, "../client/src/components/create/createMenuConfig.ts"),
  "utf-8",
);
const recurringPageSrc = readFileSync(
  resolve(__dirname, "../client/src/pages/RecurringJobsPage.tsx"),
  "utf-8",
);
const pmWizardSrc = readFileSync(
  resolve(__dirname, "../client/src/pages/PMWizardPage.tsx"),
  "utf-8",
);
const quickAddSrc = readFileSync(
  resolve(__dirname, "../client/src/components/QuickAddJobDialog.tsx"),
  "utf-8",
);

// ── Nav config destination label ──────────────────────────────────────
// Nav item literals live in tenantNavConfig.ts (canonical source of truth
// shared by AppSidebar and AppTopNav). AppSidebar is verified only for
// structural consistency — it must import from tenantNavConfig, not
// duplicate the item definitions inline.

describe("tenantNavConfig — /pm destination label", () => {
  it("nav row at href=/pm displays 'Service Plans' as its title", () => {
    // Pin the entry shape: title literal AND href together so a
    // future menu reorder can't accidentally pass.
    expect(navConfigSrc).toMatch(
      /title:\s*"Service Plans"[\s\S]+?href:\s*"\/pm"/,
    );
  });

  it("hover tooltip on the /pm row reads 'Service Plans' (not 'Maintenance' or 'Recurring Jobs')", () => {
    expect(navConfigSrc).toMatch(
      /href:\s*"\/pm"[\s\S]+?hoverText:\s*"Service Plans"/,
    );
    // The legacy hover labels are gone.
    expect(navConfigSrc).not.toMatch(
      /hoverText:\s*"Preventive Maintenance & Recurring Jobs"/,
    );
    expect(navConfigSrc).not.toMatch(
      /hoverText:\s*"Maintenance"/,
    );
  });

  it("does NOT carry a nav title literal of 'Recurring Jobs' or 'Maintenance'", () => {
    // Code comments may still mention either prior label (the data
    // model is still recurring jobs and the jobType enum is still
    // "maintenance") — but no `title: "..."` literal exists as a
    // menu entry for either prior label. Pin the assignment shape.
    expect(navConfigSrc).not.toMatch(/title:\s*"Recurring Jobs"/);
    expect(navConfigSrc).not.toMatch(/title:\s*"Maintenance"\s*,/);
  });

  it("the nav route + testid are intentionally unchanged (rename is UI-only)", () => {
    // The brief explicitly says "Do not change routes like /pm
    // … internal variable names". `/pm` was the prior route and
    // `nav-pm` was the prior testid; both stay across the rename.
    expect(navConfigSrc).toMatch(/href:\s*"\/pm"/);
    expect(navConfigSrc).toMatch(/testId:\s*"nav-pm"/);
  });

  it("AppSidebar delegates to tenantNavConfig (no inline nav item definitions)", () => {
    // Since tenantNavConfig is the canonical source, AppSidebar must
    // import from it rather than re-declaring item literals.
    expect(sidebarSrc).toMatch(/from\s+["']@\/lib\/tenantNavConfig["']/);
    expect(sidebarSrc).toMatch(/buildTenantNavItems/);
  });

  it("the quick-create header dropdown reads 'New Service Plan'", () => {
    // The old "New Maintenance Plan" / "New Recurring Job" labels
    // are both gone from the user-facing dropdown trigger.
    // createMenuConfig.ts is the source of truth for create-menu labels.
    expect(createMenuSrc).toMatch(/New Service Plan/);
    expect(createMenuSrc).not.toMatch(/New Maintenance Plan/);
  });
});

// ── Page heading at the destination ───────────────────────────────────

describe("RecurringJobsPage — page heading reflects new destination name", () => {
  it("the standalone H1 reads 'Service Plans' (matches the sidebar)", () => {
    // The H1 IS the destination's name. The card-title below
    // ("Recurring Jobs") names the listed templates and is allowed
    // to keep recurrence terminology because the items themselves
    // are recurring-job records.
    expect(recurringPageSrc).toMatch(
      /<h1[^>]*>\s*Service Plans\s*<\/h1>/,
    );
    expect(recurringPageSrc).not.toMatch(
      /<h1[^>]*>\s*Recurring Jobs\s*<\/h1>/,
    );
    expect(recurringPageSrc).not.toMatch(
      /<h1[^>]*>\s*Maintenance\s*<\/h1>/,
    );
  });

  it("internal route + component name + recurrence-behavior copy preserved", () => {
    // Internal — kept per brief.
    expect(recurringPageSrc).toMatch(/export default function RecurringJobsPage/);
    // Behavior copy — describes the recurrence-generation flow itself.
    expect(recurringPageSrc).toMatch(
      /Active recurring jobs will generate work automatically/,
    );
    // The data items are still recurring-job templates, so the
    // sub-card heading + empty state are allowed to keep the term.
    expect(recurringPageSrc).toMatch(
      /<CardTitle>\s*Recurring Jobs\s*<\/CardTitle>/,
    );
  });
});

// ── Pointer copy (toasts + dialogs that direct the user there) ───────

describe("PMWizardPage — copy that directs the user to the destination", () => {
  it("review step points at 'the Service Plans page' (not 'Maintenance' / 'Recurring Jobs')", () => {
    expect(pmWizardSrc).toMatch(
      /upcoming service work will appear on the Service Plans page when due/,
    );
  });

  it("activation toast points at 'the Service Plans page'", () => {
    expect(pmWizardSrc).toMatch(
      /Upcoming service work will appear on the Service Plans page when due/,
    );
  });

  it("post-create explanation dialog points at 'the Service Plans page'", () => {
    expect(pmWizardSrc).toMatch(
      /it will appear on the\s+Service Plans page so you can create the work order/,
    );
  });

  it("no remaining user-facing pointer says 'in Recurring Jobs' OR 'on the Maintenance page' (destination form)", () => {
    // Pin the prepositional form for both prior labels — destination
    // references must use "Service Plans" now. Internal phrases like
    // `Recurring Jobs tab` inside a docblock comment are not
    // user-facing and are allowed.
    expect(pmWizardSrc).not.toMatch(
      /\b(?:in|on|to|open|go to)\s+Recurring Jobs\b/i,
    );
    expect(pmWizardSrc).not.toMatch(
      /on the Maintenance page/,
    );
  });
});

// ── Recurrence-behavior copy is intentionally untouched ──────────────

describe("Recurrence-behavior copy is preserved (NOT renamed)", () => {
  it("QuickAddJobDialog still surfaces a 'Make Recurring' toggle", () => {
    expect(quickAddSrc).toMatch(/Make Recurring/);
  });

  it("QuickAddJobDialog still describes the 'Recurring schedule fields' block", () => {
    // The block is internal but the comment reflects the user-facing
    // label structure ("Recurring schedule" appears in form copy).
    expect(quickAddSrc).toMatch(/Recurring schedule/);
  });

  it("QuickAddJobDialog success toast still reads 'Recurring Job Created'", () => {
    // Behavior copy: notifies that a recurring-job record was
    // created. The user did create a Recurring Job (the data model);
    // calling that "Service Plan Created" would be wrong because the
    // record is a recurring-job template.
    expect(quickAddSrc).toMatch(
      /title:\s*"Recurring Job Created"/,
    );
  });

  it("RecurringJobsPage's empty state still reads 'No recurring jobs yet.'", () => {
    // Same justification: empty-state copy describes the absence of
    // recurring-job records, not the destination's name.
    expect(recurringPageSrc).toMatch(/No recurring jobs yet\./);
  });
});
