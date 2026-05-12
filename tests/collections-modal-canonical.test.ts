/**
 * Source-level canonical checks for ClientCollectionsModal.
 *
 * Verifies structure, typography, and UI invariants:
 * - ModalShell (not OperationalActionModal)
 * - Canonical typography tokens, no hex colors
 * - iPad-safe dimensions, flex-based column scrolling
 * - 3-column workspace: queue rail + middle AR + right actions/notes
 * - Client name link → /clients/:id (same route as Clients list), not /customer-companies/
 * - Compact KPI row inside middle column only (not full-width strip)
 * - Queue rail: collapsed/expanded, no "Unworked" text, compact rows
 * - Right rail: Primary Actions (no duplication with header), communication result selector
 * - Follow-up date field NOT present (deferred until queryable)
 * - Auto-activity note created on reminder send success
 * - Invoice rows: contextLabel, sentAt/viewedAt signals
 * - Selection bar below invoice sections
 * - Recent activity, payment info, recent notes
 */

import { readFileSync } from "fs";
import { describe, it, expect } from "vitest";
import { resolve } from "path";

const SRC = readFileSync(
  resolve(__dirname, "../client/src/components/collections/ClientCollectionsModal.tsx"),
  "utf8",
);

const NOTES_SRC = readFileSync(
  resolve(__dirname, "../client/src/components/collections/FollowUpNotesSection.tsx"),
  "utf8",
);

// ---------------------------------------------------------------------------
// Modal primitive
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Dimensions / iPad-safe
// ---------------------------------------------------------------------------

describe("ClientCollectionsModal — dimensions (iPad-safe)", () => {
  it("uses constrained width with iPad-safe vw sizing", () => {
    expect(SRC).toContain("w-[calc(100vw-32px)]");
    expect(SRC).toContain("max-w-[1180px]");
  });

  it("uses iPad-safe max-h", () => {
    expect(SRC).toMatch(/max-h-\[calc\(100vh-32px\)\]/);
  });

  it("uses flex-based column scrolling, not per-column fixed max-h", () => {
    // Invoice list uses flex-1 overflow-y-auto to fill available height
    expect(SRC).toMatch(/flex-1 overflow-y-auto/);
    // Right rail uses overflow-y-auto for independent scroll
    expect(SRC).toContain('data-testid="collections-right-rail"');
    // No old per-column fixed max-h from prior design
    expect(SRC).not.toMatch(/max-h-\[min\(560px,calc\(100vh-240px\)\)\]/);
    // No flex-1 min-h-0 on the outer workspace container
    expect(SRC).not.toMatch(/collections-body[\s\S]{0,200}flex-1 min-h-0/);
  });

  it("defaults queue rail collapsed on iPad and below (window.innerWidth < 1024)", () => {
    expect(SRC).toContain("window.innerWidth >= 1024");
  });
});

// ---------------------------------------------------------------------------
// Header — client profile link fix
// ---------------------------------------------------------------------------

describe("ClientCollectionsModal — header (profile link)", () => {
  it("client name link uses /clients/:id route — same route as the Clients list", () => {
    expect(SRC).toContain('data-testid="collections-customer-name"');
    // Profile link must use /clients/ (the canonical route from Clients.tsx handleRowClick)
    expect(SRC).toMatch(/Link href=\{profilePath\}/);
    expect(SRC).toContain("profilePath");
    expect(SRC).toContain("/clients/");
    // Must NOT navigate to the non-existent /customer-companies/ route
    expect(SRC).not.toMatch(/href=\{`\/customer-companies\//);
    // No separate view-profile element — the name IS the profile link
    expect(SRC).not.toContain('data-testid="collections-view-profile"');
  });

  it("profile path is derived from primaryLocationId (not customerCompanyId)", () => {
    expect(SRC).toContain("primaryLocationId");
    expect(SRC).toMatch(/primaryLocationId.*\/clients\//s);
  });

  it("does not render an avatar circle (initials element)", () => {
    expect(SRC).not.toContain("rounded-full bg-primary/10");
    expect(SRC).not.toContain("initials(");
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

  it("renders payment signal", () => {
    expect(SRC).toContain('data-testid="collections-payment-signal"');
    expect(SRC).toContain("paymentSignal");
    expect(SRC).toContain("Last payment:");
    expect(SRC).toContain("No payment activity");
  });
});

// ---------------------------------------------------------------------------
// KPI row — scoped to middle column, compact
// ---------------------------------------------------------------------------

describe("ClientCollectionsModal — KPI row (compact, middle column only)", () => {
  it("has compact KPI row with data-testid inside the middle column header", () => {
    expect(SRC).toContain('data-testid="collections-kpi-row"');
    expect(SRC).toContain('data-testid="collections-total-outstanding"');
    expect(SRC).toContain('data-testid="collections-past-due-total"');
    expect(SRC).toContain('data-testid="collections-current-total"');
  });

  it("KPI row is NOT a full-width grid strip (no grid-cols-3 gap-px bg-border strip)", () => {
    // The old full-width strip used grid-cols-3 gap-px with a bg-border wrapper
    expect(SRC).not.toMatch(/grid-cols-3 gap-px bg-border border-b border-border shrink-0/);
  });

  it("KPI row is inside the middle column header (before invoice list)", () => {
    const kpiPos = SRC.indexOf('data-testid="collections-kpi-row"');
    const invoiceListPos = SRC.indexOf('data-testid="collections-invoice-list"');
    expect(kpiPos).toBeGreaterThan(0);
    expect(invoiceListPos).toBeGreaterThan(kpiPos);
  });

  it("KPI row uses compact inline layout (flex items-center), not large card padding", () => {
    expect(SRC).toMatch(/collections-kpi-row[\s\S]{0,60}flex items-center/);
  });
});

// ---------------------------------------------------------------------------
// Header action cleanup — actions moved to right rail
// ---------------------------------------------------------------------------

describe("ClientCollectionsModal — header action cleanup", () => {
  it("Record Payment is NOT in the header (moved to right rail)", () => {
    expect(SRC).not.toContain('data-testid="collections-header-record-payment"');
  });

  it("Send Statement is NOT in the header (moved to right rail)", () => {
    expect(SRC).not.toContain('data-testid="collections-header-statement"');
  });

  it("header close button is the only header-level control (pr-10 offset for close button)", () => {
    expect(SRC).toContain("pr-10");
  });
});

// ---------------------------------------------------------------------------
// Right rail — Primary Actions
// ---------------------------------------------------------------------------

describe("ClientCollectionsModal — right rail primary actions", () => {
  it("right rail has Primary Actions section with data-testid", () => {
    expect(SRC).toContain('data-testid="collections-primary-actions"');
  });

  it("Record Payment button is in the right rail", () => {
    expect(SRC).toContain('data-testid="collections-right-record-payment"');
  });

  it("Send Statement button is in the right rail", () => {
    expect(SRC).toContain('data-testid="collections-right-statement"');
  });

  it("Send Reminder button is in the right rail (disabled when nothing selected)", () => {
    expect(SRC).toContain('data-testid="collections-right-send-reminder"');
    expect(SRC).toContain("selectedForReminder.length === 0");
  });

  it("Record Payment data-testid appears exactly twice: right rail + selection bar", () => {
    const matches = [...SRC.matchAll(/data-testid="collections-[^"]*record-payment[^"]*"/g)];
    expect(matches.length).toBe(2);
    const ids = matches.map((m) => m[0]);
    expect(ids).toContain('data-testid="collections-right-record-payment"');
    expect(ids).toContain('data-testid="collections-selection-record-payment"');
  });

  it("Statement data-testid appears exactly once (right rail only)", () => {
    const matches = [...SRC.matchAll(/data-testid="collections-[^"]*statement[^"]*"/g)];
    expect(matches.length).toBe(1);
    expect(matches[0][0]).toBe('data-testid="collections-right-statement"');
  });
});

// ---------------------------------------------------------------------------
// Right rail — Communication / Follow-Up
// ---------------------------------------------------------------------------

describe("ClientCollectionsModal — right rail communication / follow-up", () => {
  it("has communication result selector with data-testid", () => {
    expect(SRC).toContain('data-testid="collections-comm-result-select"');
  });

  it("communication result options include expected values", () => {
    expect(SRC).toContain("Left voicemail");
    expect(SRC).toContain("Spoke with customer");
    expect(SRC).toContain("Reminder sent");
    expect(SRC).toContain("Statement sent");
    expect(SRC).toContain("Promise to pay");
    expect(SRC).toContain("Needs follow-up");
  });

  it("does not show 'Unworked' anywhere in the UI", () => {
    // Unworked is not a communication outcome and should not appear
    expect(SRC).not.toMatch(/[>"]Unworked[<"]/);
    expect(SRC).not.toContain('"unworked"');
  });

  it("communication result is saved as part of note text (no separate DB field)", () => {
    // The result label is prepended/combined with the note text before saving
    expect(SRC).toContain("resultLabel");
    expect(SRC).toContain("fullText");
    // No separate communicationResult field in the save payload
    expect(SRC).not.toMatch(/communicationResult.*apiRequest/s);
  });

  it("has follow-up textarea", () => {
    expect(SRC).toContain('data-testid="collections-note-textarea"');
    expect(SRC).toContain("Add a follow-up note");
  });

  it("has Save Note submit button", () => {
    expect(SRC).toContain('data-testid="collections-note-submit"');
    expect(SRC).toContain("Save Note");
  });

  it("follow-up date field is NOT rendered (deferred — not queryable yet)", () => {
    // No date input element or followUpDate state variable — deferred until queryable from dashboard
    expect(SRC).not.toContain('type="date"');
    expect(SRC).not.toContain("followUpDate");
    // No date picker component
    expect(SRC).not.toContain("DatePicker");
    expect(SRC).not.toContain("follow-up-date");
  });

  it("does not have a note type dropdown (legacy pattern)", () => {
    expect(SRC).not.toContain("Note type");
    expect(SRC).not.toContain("NOTE_CATEGORY_PREFIX");
    expect(SRC).not.toContain("[Collections]");
  });

  it("does not have a scope radio", () => {
    expect(SRC).not.toContain("scope-customer");
    expect(SRC).not.toContain("scope-invoice");
  });
});

// ---------------------------------------------------------------------------
// Auto-activity — reminder send creates note
// ---------------------------------------------------------------------------

describe("ClientCollectionsModal — auto-activity on reminder send", () => {
  it("handleReminderSuccess creates an auto-activity note after reminder sends", () => {
    expect(SRC).toContain("handleReminderSuccess");
    // Auto-note text mentions "Reminder sent"
    expect(SRC).toMatch(/Reminder sent.*invoice/);
    // Uses saveNoteMutation.mutate for the auto-note
    expect(SRC).toContain("saveNoteMutation.mutate");
  });

  it("BatchSendInvoicesModal uses handleReminderSuccess as onSuccess callback", () => {
    expect(SRC).toContain("onSuccess={handleReminderSuccess}");
  });
});

// ---------------------------------------------------------------------------
// Invoice rows
// ---------------------------------------------------------------------------

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
    expect(SRC).toContain("(sentLabel || wasViewed) &&");
  });

  it("renders issued date in row secondary metadata", () => {
    expect(SRC).toContain("Issued {formatDate(invoice.issueDate)}");
  });
});

// ---------------------------------------------------------------------------
// Selection bar
// ---------------------------------------------------------------------------

describe("ClientCollectionsModal — selection bar", () => {
  it("SelectionBar renders null when selectedCount is 0", () => {
    expect(SRC).toMatch(/if \(selectedCount === 0\) return null/);
  });

  it("has selection-contextual Record Payment and Send Reminder", () => {
    expect(SRC).toContain('data-testid="collections-selection-record-payment"');
    expect(SRC).toContain('data-testid="collections-selection-send-reminder"');
  });

  it("SelectionBar is rendered below invoice sections (not sticky at top)", () => {
    const sectionPos = SRC.indexOf("InvoiceSection");
    const selectionBarPos = SRC.indexOf("<SelectionBar");
    expect(sectionPos).toBeGreaterThan(0);
    expect(selectionBarPos).toBeGreaterThan(sectionPos);
    expect(SRC).not.toMatch(/SelectionBar[\s\S]{0,100}sticky top-0/);
  });
});

// ---------------------------------------------------------------------------
// Recent activity
// ---------------------------------------------------------------------------

describe("ClientCollectionsModal — recent activity", () => {
  it("has Recent Activity section with data-testid", () => {
    expect(SRC).toContain('data-testid="collections-recent-activity"');
  });

  it("derives events from invoice sentAt and viewedAt", () => {
    expect(SRC).toContain('"sent"');
    expect(SRC).toContain('"viewed"');
    expect(SRC).toContain("inv.sentAt");
    expect(SRC).toContain("inv.viewedAt");
  });

  it("shows at most 3 activity events", () => {
    expect(SRC).toContain("slice(0, 3)");
  });

  it("has View all activity link", () => {
    expect(SRC).toContain('data-testid="collections-recent-activity-view-all"');
    expect(SRC).toContain("View all activity");
  });
});

// ---------------------------------------------------------------------------
// Right rail — recent notes and payment info
// ---------------------------------------------------------------------------

describe("ClientCollectionsModal — right rail: notes and payment info", () => {
  it("has right rail with data-testid", () => {
    expect(SRC).toContain('data-testid="collections-right-rail"');
  });

  it("right rail is 260px (via grid-cols) and independently scrollable", () => {
    // Width is controlled by the CSS grid column (260px), not a w-* class on the element
    expect(SRC).toMatch(/grid-cols-\[.*260px\]/);
    // The right rail element has overflow-y-auto for independent scrolling
    const railIdx = SRC.indexOf('data-testid="collections-right-rail"');
    const railElement = SRC.slice(Math.max(0, railIdx - 200), railIdx + 10);
    expect(railElement).toContain("overflow-y-auto");
  });

  it("recent notes section renders with data-testid", () => {
    expect(SRC).toContain('data-testid="collections-recent-notes"');
  });

  it("has View all notes link when profilePath available", () => {
    expect(SRC).toContain('data-testid="collections-notes-view-all"');
    expect(SRC).toContain("View all notes");
  });

  it("has payment info section with data-testid", () => {
    expect(SRC).toContain('data-testid="collections-payment-info"');
  });

  it("renders payment terms when paymentTermsDays is set", () => {
    expect(SRC).toContain('data-testid="collections-payment-terms"');
    expect(SRC).toContain("Net {customer.paymentTermsDays} days");
  });

  it("renders customer since when createdAt is set", () => {
    expect(SRC).toContain('data-testid="collections-customer-since"');
    expect(SRC).toContain("Customer since");
  });

  it("does not render 'of $X' duplicate amount text", () => {
    expect(SRC).not.toMatch(/of \{formatCurrency\(invoice\.total\)\}/);
  });
});

// ---------------------------------------------------------------------------
// Collections queue rail
// ---------------------------------------------------------------------------

describe("ClientCollectionsModal — queue rail", () => {
  it("renders the queue rail with data-testid", () => {
    expect(SRC).toContain('data-testid="collections-queue-rail"');
  });

  it("queue rail expanded width is 190px (via CSS grid column)", () => {
    expect(SRC).toContain("grid-cols-[190px_minmax(0,1fr)_260px]");
  });

  it("queue rail collapsed width is 44px (via CSS grid column)", () => {
    expect(SRC).toContain("grid-cols-[44px_minmax(0,1fr)_260px]");
  });

  it("has collapse/expand toggle button", () => {
    expect(SRC).toContain('data-testid="collections-queue-toggle"');
    expect(SRC).toContain("Collapse queue rail");
    expect(SRC).toContain("Expand queue rail");
  });

  it("collapsed rail preserves active customer indicator via data-active", () => {
    expect(SRC).toContain("data-active={String(isActive)}");
    expect(SRC).toContain("bg-primary/10 text-primary ring-1 ring-primary/30");
  });

  it("queue items are clickable and switch active customer", () => {
    expect(SRC).toContain("onClick={() => onSelect(item.customerCompanyId)");
    expect(SRC).toContain("handleQueueSelect");
    expect(SRC).toContain("setSelectedIds(new Set())");
  });

  it("queue rows are compact: show name and amount only (no session status selector)", () => {
    // No status dropdown in the queue rows
    expect(SRC).not.toMatch(/collections-queue-status-select/);
  });

  it("queue rows do NOT show 'Unworked' text anywhere", () => {
    expect(SRC).not.toMatch(/[>"]Unworked/);
    expect(SRC).not.toContain('"unworked"');
  });

  it("queue rows do NOT show detailed overdue days label alongside status", () => {
    // No separate overdue-days label in queue item rows (kept in invoice list only)
    expect(SRC).not.toMatch(/collections-queue-item[\s\S]{0,300}days overdue/);
  });

  it("queue fetches from /api/customer-companies/ar-queue", () => {
    expect(SRC).toContain("/api/customer-companies/ar-queue");
  });

  it("queue data fetch has refetchIntervalInBackground: false", () => {
    const block = SRC.slice(SRC.indexOf("ar-queue"), SRC.indexOf("ar-queue") + 300);
    expect(block).toContain("refetchIntervalInBackground: false");
  });

  it("queue header shows client count and sort label", () => {
    expect(SRC).toContain("Collections Queue");
    expect(SRC).toContain("Past due high → low");
  });

  it("collapsed rail shows initials with data-testid", () => {
    expect(SRC).toContain('data-testid={`collections-queue-initials-${item.customerCompanyId}`}');
  });
});

// ---------------------------------------------------------------------------
// AR summary interface
// ---------------------------------------------------------------------------

describe("ClientCollectionsModal — AR summary interface", () => {
  it("ARSummaryCustomer includes primaryLocationId", () => {
    expect(SRC).toContain("primaryLocationId: string | null");
  });

  it("ARQueueItem type is defined with required fields", () => {
    expect(SRC).toContain("interface ARQueueItem");
    expect(SRC).toContain("customerCompanyId: string");
    expect(SRC).toContain("displayName: string");
    expect(SRC).toContain("primaryLocationId: string | null");
    expect(SRC).toContain("pastDueTotal: string");
    expect(SRC).toContain("maxDaysOverdue: number | null");
  });

  it("ARSummaryCustomer includes paymentTermsDays and createdAt", () => {
    expect(SRC).toContain("paymentTermsDays");
    expect(SRC).toMatch(/customer.*createdAt|createdAt.*string.*null/s);
  });

  it("AR summary query uses activeCustomerCompanyId for scoping", () => {
    // Tenant/customer scoping preserved — query uses the active customer ID
    expect(SRC).toContain("/ar-summary");
    expect(SRC).toContain("activeCustomerCompanyId");
    expect(SRC).toMatch(/ar-summary.*activeCustomerCompanyId|activeCustomerCompanyId.*ar-summary/s);
  });

  it("Current section collapsible when Past Due invoices exist", () => {
    expect(SRC).toContain("collapsible={pastDueInvoices.length > 0}");
    expect(SRC).toContain("defaultCollapsed={pastDueInvoices.length > 0}");
  });
});

// ---------------------------------------------------------------------------
// FollowUpNotesSection — standalone component tests (still lives independently)
// ---------------------------------------------------------------------------

describe("FollowUpNotesSection — standalone component", () => {
  it("has plain textarea with follow-up placeholder", () => {
    expect(NOTES_SRC).toContain("Add a follow-up note");
    expect(NOTES_SRC).toContain('data-testid="collections-note-textarea"');
  });

  it("has Save Note submit button", () => {
    expect(NOTES_SRC).toContain('data-testid="collections-note-submit"');
    expect(NOTES_SRC).toContain("Save Note");
  });

  it("fetches limit+1 notes to detect hasMore", () => {
    expect(NOTES_SRC).toContain("limit + 1");
  });

  it("has TODO comment for edit/delete (not half-implemented)", () => {
    expect(NOTES_SRC).toContain("TODO(collections-notes-edit)");
    expect(NOTES_SRC).not.toMatch(/data-testid="collections-note-edit/);
    expect(NOTES_SRC).not.toMatch(/data-testid="collections-note-delete/);
  });

  it("accepts profilePath prop for View all notes link", () => {
    expect(NOTES_SRC).toContain("profilePath");
    expect(NOTES_SRC).toContain("profilePath?: string");
  });

  it("View all notes link uses profilePath when provided (not /customer-companies/)", () => {
    expect(NOTES_SRC).toMatch(/href=\{profilePath\}/);
    expect(NOTES_SRC).not.toMatch(/href=.*\/customer-companies\//);
  });

  it("shows View all notes link element in source", () => {
    expect(NOTES_SRC).toContain('data-testid="collections-notes-view-all"');
    expect(NOTES_SRC).toContain("View all notes");
  });
});
