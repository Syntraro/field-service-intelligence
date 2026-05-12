/**
 * Source-level canonical checks for ClientCollectionsModal.
 *
 * Verifies structure, typography, and UI invariants:
 * - ModalShell (not OperationalActionModal)
 * - Canonical typography tokens
 * - No hex colors
 * - iPad-safe dimensions, content-driven height
 * - No avatar element
 * - Header: name + past-due badge + compact contact metadata + payment signal
 * - Invoice rows: contextLabel used (not repeated customer name), invoice # linkable
 * - Communication signals: sentAt/viewedAt only when data exists
 * - No duplicate Record Payment / Statement buttons
 * - Selection bar only when invoices selected
 * - Simplified Follow-Up Notes (no type/scope/date fields)
 * - Recent notes displayed
 */

import { readFileSync } from "fs";
import { describe, it, expect } from "vitest";
import { resolve } from "path";

const SRC = readFileSync(
  resolve(__dirname, "../client/src/components/collections/ClientCollectionsModal.tsx"),
  "utf8",
);

describe("ClientCollectionsModal — modal primitive", () => {
  it("uses ModalShell, not OperationalActionModal for main modal", () => {
    expect(SRC).toContain("ModalShell");
    expect(SRC).not.toMatch(/export function ClientCollectionsModal[\s\S]*?OperationalActionModal/);
  });

  it("does not use legacy text size classes in className strings", () => {
    const code = SRC.split("\n")
      .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
      .join("\n");
    expect(code).not.toMatch(/className="[^"]*\btext-xs\b/);
    expect(code).not.toMatch(/className="[^"]*\btext-sm\b/);
    expect(code).not.toMatch(/className="[^"]*\btext-base\b/);
    expect(code).not.toMatch(/className="[^"]*\btext-lg\b/);
    expect(code).not.toMatch(/className="[^"]*\btext-xl\b/);
    expect(code).not.toMatch(/className="[^"]*\btext-2xl\b/);
  });

  it("uses canonical typography tokens", () => {
    expect(SRC).toMatch(/text-page-title/);
    expect(SRC).toMatch(/text-label/);
    expect(SRC).toMatch(/text-helper/);
    expect(SRC).toMatch(/text-caption/);
  });

  it("does not contain hex color literals", () => {
    expect(SRC).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
});

describe("ClientCollectionsModal — dimensions (iPad-safe)", () => {
  it("uses iPad-safe max-w", () => {
    expect(SRC).toMatch(/max-w-\[min\(1080px,calc\(100vw-32px\)\)\]/);
  });

  it("uses iPad-safe max-h", () => {
    expect(SRC).toMatch(/max-h-\[calc\(100vh-32px\)\]/);
  });

  it("uses content-driven body height with per-column max-h, not fixed full height", () => {
    // Each column has its own max-h rather than a fixed body flex-1 min-h-0
    expect(SRC).toMatch(/max-h-\[min\(560px,calc\(100vh-240px\)\)\]/);
    // Should NOT have a flex-1 min-h-0 on the body wrapper
    expect(SRC).not.toMatch(/collections-body[\s\S]{0,200}flex-1 min-h-0/);
  });
});

describe("ClientCollectionsModal — header (no avatar)", () => {
  it("does not render an avatar circle (initials element)", () => {
    expect(SRC).not.toContain("rounded-full bg-primary/10");
    expect(SRC).not.toContain("initials(");
  });

  it("renders client name with text-page-title and data-testid", () => {
    expect(SRC).toContain('className="text-page-title"');
    expect(SRC).toContain('data-testid="collections-customer-name"');
  });

  it("renders Past Due badge only when hasPastDue is true", () => {
    expect(SRC).toContain("hasPastDue &&");
    expect(SRC).toContain('data-testid="collections-past-due-badge"');
  });

  it("renders compact contact metadata section", () => {
    expect(SRC).toContain('data-testid="collections-contact-metadata"');
    expect(SRC).toContain('data-testid="collections-contact-phone"');
    expect(SRC).toContain('data-testid="collections-contact-email"');
  });

  it("renders primary contact name when available", () => {
    expect(SRC).toContain("primaryContactName");
    expect(SRC).toContain('data-testid="collections-contact-name"');
  });

  it("renders billing address or location count", () => {
    expect(SRC).toContain('data-testid="collections-billing-address"');
    expect(SRC).toContain('data-testid="collections-location-count"');
  });

  it("renders payment signal in header", () => {
    expect(SRC).toContain('data-testid="collections-payment-signal"');
    expect(SRC).toContain("paymentSignal");
    expect(SRC).toContain("Last payment:");
    expect(SRC).toContain("No payment activity");
  });

  it("view profile link is in header contact metadata, not in quick actions", () => {
    expect(SRC).toContain('data-testid="collections-view-profile"');
    // Only one occurrence
    const count = [...SRC.matchAll(/data-testid="collections-view-profile"/g)].length;
    expect(count).toBe(1);
  });
});

describe("ClientCollectionsModal — invoice rows", () => {
  it("invoice number is a link", () => {
    expect(SRC).toContain('data-testid={`collections-invoice-link-${invoice.id}`}');
    expect(SRC).toContain("href={`/invoices/${invoice.id}`}");
  });

  it("renders contextLabel for invoice context (not repeated customer name)", () => {
    expect(SRC).toContain("invoice.contextLabel");
    expect(SRC).toContain('data-testid={`collections-invoice-context-${invoice.id}`}');
  });

  it("renders communication signals only when real data exists (sentAt/viewedAt)", () => {
    expect(SRC).toContain("sentAt");
    expect(SRC).toContain("viewedAt");
    expect(SRC).toContain("Sent {sentLabel}");
    expect(SRC).toContain("Viewed by customer");
    expect(SRC).toContain('data-testid={`collections-invoice-comm-${invoice.id}`}');
    // Conditional: only rendered when sentLabel || wasViewed
    expect(SRC).toContain("(sentLabel || wasViewed) &&");
  });

  it("renders issued date in row secondary metadata", () => {
    expect(SRC).toContain("Issued {formatDate(invoice.issueDate)}");
  });
});

describe("ClientCollectionsModal — no duplicate action buttons", () => {
  it("Record Payment data-testid appears exactly twice (rail + selection bar)", () => {
    const matches = [...SRC.matchAll(/data-testid="collections-[^"]*record-payment[^"]*"/g)];
    expect(matches.length).toBe(2);
    const ids = matches.map((m) => m[0]);
    expect(ids).toContain('data-testid="collections-rail-record-payment"');
    expect(ids).toContain('data-testid="collections-selection-record-payment"');
  });

  it("Statement data-testid appears exactly once (rail only)", () => {
    const matches = [...SRC.matchAll(/data-testid="collections-[^"]*statement[^"]*"/g)];
    expect(matches.length).toBe(1);
    expect(matches[0][0]).toBe('data-testid="collections-rail-statement"');
  });
});

describe("ClientCollectionsModal — selection bar", () => {
  it("SelectionBar renders null when selectedCount is 0", () => {
    expect(SRC).toMatch(/if \(selectedCount === 0\) return null/);
  });

  it("has selection-contextual Record Payment and Send Reminder", () => {
    expect(SRC).toContain('data-testid="collections-selection-record-payment"');
    expect(SRC).toContain('data-testid="collections-selection-send-reminder"');
  });
});

describe("ClientCollectionsModal — follow-up notes simplified", () => {
  it("has no note type dropdown", () => {
    expect(SRC).not.toContain("Note type");
    expect(SRC).not.toContain("NOTE_CATEGORY_PREFIX");
    expect(SRC).not.toContain("[Collections]");
  });

  it("has no scope radio", () => {
    expect(SRC).not.toContain("scope-customer");
    expect(SRC).not.toContain("scope-invoice");
  });

  it("has plain textarea with follow-up placeholder", () => {
    expect(SRC).toContain("Add a follow-up note");
    expect(SRC).toContain('data-testid="collections-note-textarea"');
  });

  it("has Save Note submit button", () => {
    expect(SRC).toContain('data-testid="collections-note-submit"');
    expect(SRC).toContain("Save Note");
  });

  it("shows recent notes from GET /notes endpoint", () => {
    expect(SRC).toContain('data-testid="collections-recent-notes"');
    expect(SRC).toContain("/notes?limit=3");
  });

  it("has TODO comment for edit/delete (not half-implemented)", () => {
    expect(SRC).toContain("TODO(collections-notes-edit)");
    // Should NOT have edit/delete buttons (just the TODO comment)
    expect(SRC).not.toMatch(/data-testid="collections-note-edit/);
    expect(SRC).not.toMatch(/data-testid="collections-note-delete/);
  });
});

describe("ClientCollectionsModal — layout", () => {
  it("has right rail with data-testid", () => {
    expect(SRC).toContain('data-testid="collections-right-rail"');
  });

  it("has summary cards with correct data-testids", () => {
    expect(SRC).toContain('data-testid="collections-summary-cards"');
    expect(SRC).toContain('data-testid="collections-total-outstanding"');
    expect(SRC).toContain('data-testid="collections-past-due-total"');
    expect(SRC).toContain('data-testid="collections-current-total"');
  });

  it("has payment info section in right rail", () => {
    expect(SRC).toContain('data-testid="collections-payment-info"');
  });

  it("Current section collapsible when Past Due invoices exist", () => {
    expect(SRC).toContain("collapsible={pastDueInvoices.length > 0}");
    expect(SRC).toContain("defaultCollapsed={pastDueInvoices.length > 0}");
  });

  it("does not render 'of $X' duplicate amount text", () => {
    expect(SRC).not.toMatch(/of \{formatCurrency\(invoice\.total\)\}/);
  });
});
