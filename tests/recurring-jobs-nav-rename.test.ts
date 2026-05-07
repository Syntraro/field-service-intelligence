/**
 * Recurring Jobs → Maintenance — sidebar/menu destination rename
 * (2026-05-06).
 *
 * The destination at `/pm` is now labeled "Maintenance" everywhere
 * the user reads it as a navigation target. The data model, the
 * route, the API surface, and the in-page recurrence-behavior copy
 * (Make Recurring, Recurring schedule, "Recurring Job Created"
 * toasts, etc.) intentionally remain — those describe behavior, not
 * the destination name.
 *
 * This file is a source-pin regression: if a future refactor
 * accidentally replaces "recurring" globally OR reverts the
 * destination labels, these assertions fail.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const sidebarSrc = readFileSync(
  resolve(__dirname, "../client/src/components/AppSidebar.tsx"),
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

// ── Sidebar destination label ─────────────────────────────────────────

describe("AppSidebar — /pm destination label", () => {
  it("nav row at href=/pm displays 'Maintenance' as its title", () => {
    // Pin the entry shape: title literal AND href together so a
    // future menu reorder can't accidentally pass.
    expect(sidebarSrc).toMatch(
      /title:\s*"Maintenance"[\s\S]+?href:\s*"\/pm"/,
    );
  });

  it("hover tooltip on the /pm row reads 'Maintenance' (not 'Recurring Jobs')", () => {
    expect(sidebarSrc).toMatch(
      /href:\s*"\/pm"[\s\S]+?hoverText:\s*"Maintenance"/,
    );
    // The legacy hover label is gone.
    expect(sidebarSrc).not.toMatch(
      /hoverText:\s*"Preventive Maintenance & Recurring Jobs"/,
    );
  });

  it("does NOT carry a sidebar nav title literal of 'Recurring Jobs'", () => {
    // Code comments may still mention "Recurring Jobs" (the data
    // model) — but no `title: "Recurring Jobs"` literal exists as a
    // menu entry. Pin the assignment shape.
    expect(sidebarSrc).not.toMatch(/title:\s*"Recurring Jobs"/);
  });

  it("the nav route + testid are intentionally unchanged (rename is UI-only)", () => {
    // The brief explicitly says "Do not change routes like /recurring-jobs
    // … internal variable names". `/pm` was the prior route and
    // `nav-pm` was the prior testid; both stay.
    expect(sidebarSrc).toMatch(/href:\s*"\/pm"/);
    expect(sidebarSrc).toMatch(/testId:\s*"nav-pm"/);
  });
});

// ── Page heading at the destination ───────────────────────────────────

describe("RecurringJobsPage — page heading reflects new destination name", () => {
  it("the standalone H1 reads 'Maintenance' (matches the sidebar)", () => {
    // The H1 IS the destination's name. The card-title below
    // ("Recurring Jobs") names the listed templates and is allowed
    // to keep recurrence terminology because the items themselves
    // are recurring-job records.
    expect(recurringPageSrc).toMatch(
      /<h1[^>]*>\s*Maintenance\s*<\/h1>/,
    );
    expect(recurringPageSrc).not.toMatch(
      /<h1[^>]*>\s*Recurring Jobs\s*<\/h1>/,
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
  it("review step points at 'the Maintenance page' (not 'Recurring Jobs')", () => {
    expect(pmWizardSrc).toMatch(
      /upcoming maintenance will appear on the Maintenance page when due/,
    );
  });

  it("activation toast points at 'the Maintenance page'", () => {
    expect(pmWizardSrc).toMatch(
      /Upcoming maintenance will appear on the Maintenance page when due/,
    );
  });

  it("post-create explanation dialog points at 'the Maintenance page'", () => {
    expect(pmWizardSrc).toMatch(
      /it will appear on the\s+Maintenance page so you can create the work order/,
    );
  });

  it("no remaining user-facing pointer says 'in Recurring Jobs' (destination form)", () => {
    // Pin the prepositional form — "in Recurring Jobs" / "to Recurring
    // Jobs" / "on Recurring Jobs" are the destination references.
    // Internal phrases like `Recurring Jobs tab` inside a docblock
    // comment are not user-facing and are allowed.
    expect(pmWizardSrc).not.toMatch(
      /\b(?:in|on|to|open|go to)\s+Recurring Jobs\b/i,
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
    // calling that "Maintenance Created" would be wrong because the
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
