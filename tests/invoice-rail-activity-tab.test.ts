/**
 * Invoice Detail right rail — Notes & Activity tab source-pin tests (2026-05-10).
 *
 * Verifies the Notes & Activity tab in InvoiceDetailPage's canonical right rail:
 *   - Tab exists as second tab (after Summary)
 *   - Activity icon imported from lucide-react
 *   - +Add note action wired to notesAddSignal
 *   - Content mounts InvoiceActivityPanel with invoiceId + notesAddSignal
 *   - InvoiceActivityPanel exists at canonical path and renders EntityNotesPanel + timeline
 *   - Timeline fetch is guarded with refetchIntervalInBackground: false
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const INVOICE_DETAIL = resolve(ROOT, "client/src/pages/InvoiceDetailPage.tsx");
const ACTIVITY_PANEL = resolve(ROOT, "client/src/components/invoice/InvoiceActivityPanel.tsx");

const invoiceSrc = readFileSync(INVOICE_DETAIL, "utf-8");
const activitySrc = readFileSync(ACTIVITY_PANEL, "utf-8");

// ── 1. File existence ──────────────────────────────────────────────

describe("InvoiceActivityPanel — file exists", () => {
  it("InvoiceActivityPanel.tsx exists at canonical path", () => {
    expect(existsSync(ACTIVITY_PANEL)).toBe(true);
  });
});

// ── 2. Tab existence and position ─────────────────────────────────

describe("InvoiceDetailPage Notes & Activity tab — existence", () => {
  it("declares id: \"notes_activity\" in invoiceRailTabs", () => {
    const arrStart = invoiceSrc.indexOf("const invoiceRailTabs:");
    const arrEnd = invoiceSrc.indexOf("];", arrStart);
    expect(invoiceSrc.slice(arrStart, arrEnd)).toMatch(/id:\s*"notes_activity"/);
  });

  it("Notes & Activity tab is the second tab (position 1 in order)", () => {
    const arrStart = invoiceSrc.indexOf("const invoiceRailTabs:");
    const arrEnd = invoiceSrc.indexOf("];", arrStart);
    const arrSlice = invoiceSrc.slice(arrStart, arrEnd);
    const idOrder: string[] = [];
    const re = /\bid:\s*"(\w+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(arrSlice)) !== null) idOrder.push(m[1]);
    expect(idOrder[1]).toBe("notes_activity");
  });

  it("Notes & Activity tab label is \"Notes & Activity\"", () => {
    expect(invoiceSrc).toMatch(
      /id:\s*"notes_activity"[\s\S]{0,400}?label:\s*"Notes & Activity"/,
    );
  });

  it("Activity icon imported from lucide-react", () => {
    expect(invoiceSrc).toMatch(
      /import\s*\{[\s\S]*?\bActivity\b[\s\S]*?\}\s*from\s*["']lucide-react["']/,
    );
  });

  it("Notes & Activity tab carries Activity icon and stable testId", () => {
    expect(invoiceSrc).toMatch(
      /id:\s*"notes_activity"[\s\S]{0,400}?icon:\s*Activity[\s\S]{0,400}?testId:\s*"invoice-rail-tab-notes-activity"/,
    );
  });
});

// ── 3. +Add note action wiring ─────────────────────────────────────

describe("InvoiceDetailPage Notes & Activity tab — +Add note action", () => {
  it("+Add button is in the action slot with data-testid button-add-note-rail", () => {
    expect(invoiceSrc).toMatch(
      /id:\s*"notes_activity"[\s\S]{0,1600}?action:\s*\([\s\S]{0,400}?data-testid="button-add-note-rail"/,
    );
  });

  it("+Add button bumps notesAddSignal", () => {
    expect(invoiceSrc).toMatch(
      /id:\s*"notes_activity"[\s\S]{0,1600}?setNotesAddSignal\(\(n\)\s*=>\s*n\s*\+\s*1\)/,
    );
  });
});

// ── 4. InvoiceActivityPanel wiring ────────────────────────────────

describe("InvoiceDetailPage Notes & Activity tab — InvoiceActivityPanel wiring", () => {
  it("mounts <InvoiceActivityPanel invoiceId={invoiceId}>", () => {
    expect(invoiceSrc).toMatch(
      /id:\s*"notes_activity"[\s\S]{0,1600}?<InvoiceActivityPanel[\s\S]{0,400}?invoiceId=\{invoiceId\}/,
    );
  });

  it("passes notesAddSignal to InvoiceActivityPanel", () => {
    expect(invoiceSrc).toMatch(
      /id:\s*"notes_activity"[\s\S]{0,1600}?notesAddSignal=\{notesAddSignal\}/,
    );
  });

  it("InvoiceActivityPanel imported from canonical path", () => {
    expect(invoiceSrc).toMatch(
      /import.*InvoiceActivityPanel.*from.*components\/invoice\/InvoiceActivityPanel/,
    );
  });
});

// ── 5. InvoiceActivityPanel internals ─────────────────────────────

describe("InvoiceActivityPanel — internals", () => {
  it("renders EntityNotesPanel", () => {
    expect(activitySrc).toMatch(/<EntityNotesPanel/);
  });

  it("passes entityType=\"invoice\" to EntityNotesPanel", () => {
    expect(activitySrc).toMatch(/entityType="invoice"/);
  });

  it("passes openAddNoteSignal to EntityNotesPanel", () => {
    expect(activitySrc).toMatch(/openAddNoteSignal=\{notesAddSignal\}/);
  });

  it("fetches timeline from /api/invoices/:id/timeline", () => {
    expect(activitySrc).toMatch(/\/api\/invoices\/\$\{invoiceId\}\/timeline/);
  });

  it("timeline query is guarded with refetchIntervalInBackground: false", () => {
    expect(activitySrc).toMatch(/refetchIntervalInBackground:\s*false/);
  });

  it("renders data-testid invoice-activity-panel container", () => {
    expect(activitySrc).toMatch(/data-testid="invoice-activity-panel"/);
  });

  it("outer container uses space-y-3 to separate Notes and Activity cards", () => {
    expect(activitySrc).toMatch(/className="space-y-3"[\s\S]{0,50}?data-testid="invoice-activity-panel"/);
  });

  it("Activity section rendered inside canonical RailContentCard", () => {
    expect(activitySrc).toMatch(/RailContentCard[\s\S]{0,100}?testId="invoice-timeline-section"/);
  });

  it("Activity card uses RailContentCardTitle for heading", () => {
    expect(activitySrc).toMatch(/RailContentCardTitle[\s\S]{0,50}?Activity/);
  });

  it("imports RailContentCard from canonical detail-rail path", () => {
    expect(activitySrc).toMatch(
      /import[\s\S]{0,100}?RailContentCard[\s\S]{0,100}?from.*detail-rail\/RailContentCard/,
    );
  });

  it("uses text-helper typography token (no text-xs)", () => {
    expect(activitySrc).not.toMatch(/\btext-xs\b/);
  });
});
