/**
 * Receivables routing audit (2026-05-13, updated 2026-05-13 Phase 1 restructure).
 *
 * Source-level guards for the Receivables workspace routing:
 *   - /receivables renders ReceivablesPage with invoices as default tab
 *   - Queue tab removed; ?tab=queue normalizes to invoices
 *   - InvoicesWorkspaceTab is the three-panel invoice workspace
 *   - InvoiceViewRail renders five Phase 1 views
 *   - ReceivablesActionsRail shows empty state and action buttons
 *   - InvoiceListPanel accepts activeView prop and maps views to filters
 *   - URL-based tab + view switching wired via useSearch
 *   - /invoices redirects to /receivables
 *   - Dashboard filter links target /receivables?tab=invoices&filter=...
 *   - Sidebar item is "Receivables" pointing at /receivables
 *   - Sidebar active state covers /receivables, /invoices/new, /invoices/:id
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");

function src(relPath: string) {
  return readFileSync(join(ROOT, relPath), "utf-8");
}

const receivablesPage        = src("client/src/pages/ReceivablesPage.tsx");
const invoicesWorkspaceTab   = src("client/src/pages/receivables/InvoicesWorkspaceTab.tsx");
const invoiceViewRail        = src("client/src/pages/receivables/InvoiceViewRail.tsx");
const receivablesActionsRail = src("client/src/pages/receivables/ReceivablesActionsRail.tsx");
const invoiceListPanel       = src("client/src/components/invoices/InvoiceListPanel.tsx");
const paymentsTab            = src("client/src/pages/receivables/PaymentsTab.tsx");
const insightsTab            = src("client/src/pages/receivables/InsightsTab.tsx");
const invoicesListPage       = src("client/src/pages/InvoicesListPage.tsx");
const paymentsDashPage       = src("client/src/pages/PaymentsDashboardPage.tsx");
const appSrc                 = src("client/src/App.tsx");
const sidebar                = src("client/src/components/AppSidebar.tsx");
const dashNav                = src("client/src/lib/dashboardNavigation.ts");
const topKpi                 = src("client/src/components/dashboard/TopKpiRow.tsx");
const rightCol               = src("client/src/components/dashboard/RightColumnFinancialCards.tsx");
const universalSearch        = src("client/src/components/UniversalSearch.tsx");
const invoiceDetail          = src("client/src/pages/InvoiceDetailPage.tsx");
const newInvoicePage         = src("client/src/pages/NewInvoicePage.tsx");

// ── ReceivablesPage ──────────────────────────────────────────────────

describe("ReceivablesPage", () => {
  it("renders with data-testid=receivables-page", () => {
    expect(receivablesPage).toMatch(/data-testid="receivables-page"/);
  });

  it("invoices is the default tab (readTabFromSearch returns invoices when no param)", () => {
    // Default branch returns "invoices", not "queue"
    expect(receivablesPage).toMatch(/: "invoices"/);
    expect(receivablesPage).toMatch(/readTabFromSearch/);
  });

  it("normalizes ?tab=queue to invoices", () => {
    expect(receivablesPage).toMatch(/t === "queue".*return "invoices"/);
  });

  it("reads active tab from URL search params via useSearch", () => {
    expect(receivablesPage).toMatch(/useSearch/);
    expect(receivablesPage).toMatch(/params\.get\("tab"\)/);
  });

  it("updates URL on tab change (handleTabChange)", () => {
    expect(receivablesPage).toMatch(/handleTabChange/);
    expect(receivablesPage).toMatch(/setLocation.*receivables/);
  });

  it("tab list contains Invoices, Payments, Insights (Activity removed)", () => {
    expect(receivablesPage).toMatch(/value: "invoices"/);
    expect(receivablesPage).toMatch(/value: "payments"/);
    expect(receivablesPage).toMatch(/value: "insights"/);
    expect(receivablesPage).not.toMatch(/value: "activity"/);
  });

  it("tab list does NOT contain a Queue tab", () => {
    expect(receivablesPage).not.toMatch(/value: "queue"/);
    expect(receivablesPage).not.toMatch(/label: "Queue"/);
  });

  it("tab-content-invoices wraps InvoicesWorkspaceTab with h-full overflow-hidden", () => {
    expect(receivablesPage).toMatch(/h-full overflow-hidden.*data-testid="tab-content-invoices"/s);
  });

  it("renders InvoicesWorkspaceTab for the invoices tab", () => {
    expect(receivablesPage).toMatch(/InvoicesWorkspaceTab/);
    expect(receivablesPage).toMatch(/<InvoicesWorkspaceTab/);
  });

  it("does not carry font-semibold on text-page-title", () => {
    expect(receivablesPage).not.toMatch(/text-page-title font-semibold/);
  });

  it("does NOT import or render QueueTab", () => {
    expect(receivablesPage).not.toMatch(/QueueTab/);
  });

  it("does NOT import or render InvoicesTab", () => {
    expect(receivablesPage).not.toMatch(/InvoicesTab/);
  });
});

// ── InvoicesWorkspaceTab ─────────────────────────────────────────────

describe("InvoicesWorkspaceTab", () => {
  it("renders a three-panel layout with data-testid", () => {
    expect(invoicesWorkspaceTab).toMatch(/data-testid="invoices-workspace-tab"/);
  });

  it("reads view from URL search params", () => {
    expect(invoicesWorkspaceTab).toMatch(/useSearch/);
    expect(invoicesWorkspaceTab).toMatch(/readViewFromSearch/);
  });

  it("exports readViewFromSearch for URL normalization", () => {
    expect(invoicesWorkspaceTab).toMatch(/export function readViewFromSearch/);
  });

  it("maps ?tab=invoices&filter=awaiting_payment to awaiting-payment view (legacy compat)", () => {
    expect(invoicesWorkspaceTab).toMatch(/awaiting_payment.*awaiting-payment/);
  });

  it("maps ?tab=invoices&filter=overdue to overdue view", () => {
    expect(invoicesWorkspaceTab).toMatch(/overdue.*overdue/);
  });

  it("renders InvoiceViewRail as left rail", () => {
    expect(invoicesWorkspaceTab).toMatch(/<InvoiceViewRail/);
  });

  it("renders InvoiceListPanel as center panel", () => {
    expect(invoicesWorkspaceTab).toMatch(/<InvoiceListPanel/);
  });

  it("renders ReceivablesActionsRail as right rail", () => {
    expect(invoicesWorkspaceTab).toMatch(/<ReceivablesActionsRail/);
  });

  it("passes activeView to InvoiceListPanel", () => {
    expect(invoicesWorkspaceTab).toMatch(/activeView=\{activeView\}/);
  });

  it("passes onSelectionChange to InvoiceListPanel", () => {
    expect(invoicesWorkspaceTab).toMatch(/onSelectionChange=\{handleSelectionChange\}/);
  });

  it("passes context to ReceivablesActionsRail", () => {
    expect(invoicesWorkspaceTab).toMatch(/context=\{selectedContext\}/);
  });

  it("exports SelectedReceivablesContext type", () => {
    expect(invoicesWorkspaceTab).toMatch(/SelectedReceivablesContext/);
    expect(invoicesWorkspaceTab).toMatch(/selectedInvoiceIds: string\[\]/);
    expect(invoicesWorkspaceTab).toMatch(/customerCompanyId: string \| null/);
  });

  it("has a VALID_VIEWS array with all 11 views (Phase 1 + Phase 2)", () => {
    expect(invoicesWorkspaceTab).toMatch(/"all"/);
    expect(invoicesWorkspaceTab).toMatch(/"overdue"/);
    expect(invoicesWorkspaceTab).toMatch(/"awaiting-payment"/);
    expect(invoicesWorkspaceTab).toMatch(/"drafts"/);
    expect(invoicesWorkspaceTab).toMatch(/"paid"/);
    expect(invoicesWorkspaceTab).toMatch(/"needs-follow-up"/);
    expect(invoicesWorkspaceTab).toMatch(/"sent-this-week"/);
    expect(invoicesWorkspaceTab).toMatch(/"no-recent-contact"/);
    expect(invoicesWorkspaceTab).toMatch(/"high-balance"/);
    expect(invoicesWorkspaceTab).toMatch(/"disputed"/);
    expect(invoicesWorkspaceTab).toMatch(/"promised-payment"/);
  });

  it("fetches view counts from /api/receivables/views/counts (one request)", () => {
    expect(invoicesWorkspaceTab).toMatch(/\/api\/receivables\/views\/counts/);
    // One query, not per-view
    const countOccurrences = (invoicesWorkspaceTab.match(/\/api\/receivables\/views\/counts/g) ?? []).length;
    expect(countOccurrences).toBe(1);
  });

  it("passes counts to InvoiceViewRail", () => {
    expect(invoicesWorkspaceTab).toMatch(/counts=\{viewCounts\}/);
  });

  it("passes receivablesMode to InvoiceListPanel", () => {
    expect(invoicesWorkspaceTab).toMatch(/receivablesMode/);
  });

  it("uses stable query key for view counts: [receivables, views, counts]", () => {
    expect(invoicesWorkspaceTab).toMatch(/\["receivables", "views", "counts"\]/);
  });
});

// ── InvoiceViewRail ──────────────────────────────────────────────────

describe("InvoiceViewRail", () => {
  it("renders with data-testid=invoice-view-rail", () => {
    expect(invoiceViewRail).toMatch(/data-testid="invoice-view-rail"/);
  });

  it("renders all Phase 1 views (still present after Phase 2B expansion)", () => {
    // Views are rendered from the ViewButton component via a dynamic testid template.
    expect(invoiceViewRail).toMatch(/data-testid=\{`invoice-view-\$\{item\.value\}`\}/);
    // All five Phase 1 values must still be declared.
    expect(invoiceViewRail).toMatch(/value: "all"/);
    expect(invoiceViewRail).toMatch(/value: "overdue"/);
    expect(invoiceViewRail).toMatch(/value: "awaiting-payment"/);
    expect(invoiceViewRail).toMatch(/value: "drafts"/);
    expect(invoiceViewRail).toMatch(/value: "paid"/);
  });

  it("labels the views correctly", () => {
    expect(invoiceViewRail).toMatch(/All Invoices/);
    expect(invoiceViewRail).toMatch(/Overdue/);
    expect(invoiceViewRail).toMatch(/Awaiting Payment/);
    expect(invoiceViewRail).toMatch(/Drafts/);
    expect(invoiceViewRail).toMatch(/Paid/);
  });

  it("accepts activeView and onViewChange props", () => {
    expect(invoiceViewRail).toMatch(/activeView: InvoiceView/);
    expect(invoiceViewRail).toMatch(/onViewChange/);
  });

  it("marks the active view with aria-current='page'", () => {
    expect(invoiceViewRail).toMatch(/aria-current=\{isActive \? "page" : undefined\}/);
  });

  it("calls onViewChange when a view is clicked", () => {
    expect(invoiceViewRail).toMatch(/onClick.*onViewChange/s);
  });

  it("renders all 6 Phase 2 views (Needs Follow-up, Disputed, Promised Payment, etc.)", () => {
    expect(invoiceViewRail).toMatch(/Needs Follow-up/);
    expect(invoiceViewRail).toMatch(/Sent This Week/);
    expect(invoiceViewRail).toMatch(/No Recent Contact/);
    expect(invoiceViewRail).toMatch(/High Balance/);
    expect(invoiceViewRail).toMatch(/Disputed/);
    expect(invoiceViewRail).toMatch(/Promised Payment/);
  });

  it("shows count badges from counts prop (no mock values)", () => {
    // Rail accepts a counts prop and renders count when non-zero
    expect(invoiceViewRail).toMatch(/counts\?/);
    expect(invoiceViewRail).toMatch(/countsKey/);
    // No hardcoded numeric mock badge values
    expect(invoiceViewRail).not.toMatch(/badge.*>12</);
  });

  it("count badge is failure-safe — counts prop is optional", () => {
    expect(invoiceViewRail).toMatch(/counts\?:/);
  });

  it("groups views into Primary and Secondary sections", () => {
    expect(invoiceViewRail).toMatch(/PRIMARY_VIEWS/);
    expect(invoiceViewRail).toMatch(/SECONDARY_VIEWS/);
  });

  it("exports ViewCounts interface", () => {
    expect(invoiceViewRail).toMatch(/export interface ViewCounts/);
  });
});

// ── ReceivablesActionsRail ───────────────────────────────────────────

describe("ReceivablesActionsRail", () => {
  it("renders empty state with data-testid when context is null", () => {
    expect(receivablesActionsRail).toMatch(/data-testid="receivables-actions-rail-empty"/);
    expect(receivablesActionsRail).toMatch(/Select an invoice to see receivables actions/);
  });

  it("renders the actions section with data-testid when context exists", () => {
    expect(receivablesActionsRail).toMatch(/data-testid="receivables-actions-rail"/);
    expect(receivablesActionsRail).toMatch(/data-testid="receivables-primary-actions"/);
  });

  it("has Record Payment action button", () => {
    expect(receivablesActionsRail).toMatch(/data-testid="receivables-action-record-payment"/);
    expect(receivablesActionsRail).toMatch(/Record Payment/);
  });

  it("has Send Statement action button", () => {
    expect(receivablesActionsRail).toMatch(/data-testid="receivables-action-send-statement"/);
    expect(receivablesActionsRail).toMatch(/Send Statement/);
  });

  it("has Send Reminder action button", () => {
    expect(receivablesActionsRail).toMatch(/data-testid="receivables-action-send-reminder"/);
    expect(receivablesActionsRail).toMatch(/Send Reminder/);
  });

  it("has Set Follow-up action button (Phase 2B)", () => {
    expect(receivablesActionsRail).toMatch(/data-testid="receivables-action-set-follow-up"/);
    expect(receivablesActionsRail).toMatch(/Set Follow-up/);
  });

  it("has Record Promise to Pay action button (Phase 2B)", () => {
    expect(receivablesActionsRail).toMatch(/data-testid="receivables-action-promise-to-pay"/);
    expect(receivablesActionsRail).toMatch(/Record Promise to Pay/);
  });

  it("has Mark Disputed action button (Phase 2B)", () => {
    expect(receivablesActionsRail).toMatch(/data-testid="receivables-action-mark-disputed"/);
    expect(receivablesActionsRail).toMatch(/Mark Disputed/);
  });

  it("has More Actions dropdown", () => {
    expect(receivablesActionsRail).toMatch(/data-testid="receivables-action-more"/);
    expect(receivablesActionsRail).toMatch(/More Actions/);
  });

  it("section label reads 'Single invoice actions' (not the old generic 'Actions')", () => {
    expect(receivablesActionsRail).toMatch(/Single invoice actions/);
    expect(receivablesActionsRail).not.toMatch(/>Actions</);
  });

  it("primary action buttons are hidden on multi-select (isMultiSelect branch)", () => {
    // Phase 2B stabilization: buttons are rendered inside the !isMultiSelect branch,
    // not disabled — avoids tab-focus on unreachable actions.
    expect(receivablesActionsRail).toMatch(/isMultiSelect/);
    expect(receivablesActionsRail).toMatch(/data-testid="multi-select-hint"/);
    // Buttons still exist in source (rendered for single-select)
    expect(receivablesActionsRail).toMatch(/data-testid="receivables-action-set-follow-up"/);
    expect(receivablesActionsRail).toMatch(/data-testid="receivables-action-promise-to-pay"/);
    expect(receivablesActionsRail).toMatch(/data-testid="receivables-action-mark-disputed"/);
    // Removed old pattern: disabled={!singleInvoiceId} on each button
    expect(receivablesActionsRail).not.toMatch(/disabled=\{!singleInvoiceId\}/);
  });

  it("primary actions section renders the buttons (not the hint) on single-select", () => {
    // The disambiguation message and the buttons are in separate conditional branches
    expect(receivablesActionsRail).toMatch(/isMultiSelect[\s\S]{0,200}multi-select-hint/);
    expect(receivablesActionsRail).not.toMatch(/disabled=\{true\}/);
  });

  it("multi-select shows helper copy: 'Select one invoice to use single-invoice actions'", () => {
    expect(receivablesActionsRail).toMatch(/Select one invoice to use single-invoice actions/);
    expect(receivablesActionsRail).toMatch(/isMultiSelect/);
  });

  it("Record Payment and Send Statement moved to More Actions dropdown", () => {
    expect(receivablesActionsRail).toMatch(/data-testid="receivables-action-record-payment"/);
    expect(receivablesActionsRail).toMatch(/data-testid="receivables-action-send-statement"/);
  });

  it("Write Off Balance remains disabled (Phase 2C)", () => {
    expect(receivablesActionsRail).toMatch(/<DropdownMenuItem disabled>Write Off Balance<\/DropdownMenuItem>/);
  });

  it("Set Follow-up opens SetFollowUpDialog", () => {
    expect(receivablesActionsRail).toMatch(/SetFollowUpDialog/);
    expect(receivablesActionsRail).toMatch(/followUpOpen/);
    expect(receivablesActionsRail).toMatch(/setFollowUpOpen/);
  });

  it("Record Promise to Pay opens PromiseToPayDialog", () => {
    expect(receivablesActionsRail).toMatch(/PromiseToPayDialog/);
    expect(receivablesActionsRail).toMatch(/promiseOpen/);
  });

  it("Mark Disputed opens MarkDisputedDialog", () => {
    expect(receivablesActionsRail).toMatch(/MarkDisputedDialog/);
    expect(receivablesActionsRail).toMatch(/disputeOpen/);
  });

  it("Send Reminder calls /api/invoices/bulk-send-reminders (not a navigation)", () => {
    expect(receivablesActionsRail).toMatch(/bulk-send-reminders/);
    // Must not navigate to invoice detail as fallback for reminder
    expect(receivablesActionsRail).not.toMatch(/Send Reminder[\s\S]*?setLocation.*invoices/);
  });

  it("mutations use receivablesKeys helpers (Phase 2B: centralized query key invalidation)", () => {
    // Phase 2B stabilization: the rail uses receivablesKeys helpers instead of ad-hoc string arrays.
    // Reminder mutation invalidates view counts via the helper.
    // Invoice list invalidation is now scoped to activeView inside the dialog components.
    expect(receivablesActionsRail).toMatch(/receivablesKeys\.viewsCounts\(\)/);
    // Broad literal key ["receivables", "invoices"] removed from the rail
    expect(receivablesActionsRail).not.toMatch(/"receivables", "invoices"\]/);
    // The rail passes activeView to dialogs so they can target the right cache slice
    expect(receivablesActionsRail).toMatch(/activeView=\{activeView\}/);
  });

  it("does NOT render mock DSO, on-time rate, or YTD values", () => {
    expect(receivablesActionsRail).not.toMatch(/Days Sales Outstanding/);
    expect(receivablesActionsRail).not.toMatch(/On-time Rate/);
    expect(receivablesActionsRail).not.toMatch(/Invoiced YTD/);
  });

  it("does NOT write to invoice_notes or collection_notes", () => {
    expect(receivablesActionsRail).not.toMatch(/invoice_notes/);
    expect(receivablesActionsRail).not.toMatch(/collection_notes/);
    expect(receivablesActionsRail).not.toMatch(/\/api\/invoices\/.*\/notes/);
  });
});

// ── InvoiceListPanel ─────────────────────────────────────────────────

describe("InvoiceListPanel", () => {
  it("exports InvoiceView type", () => {
    expect(invoiceListPanel).toMatch(/export type InvoiceView/);
  });

  it("exports SelectionContext type", () => {
    expect(invoiceListPanel).toMatch(/export interface SelectionContext/);
    expect(invoiceListPanel).toMatch(/selectedInvoiceIds: string\[\]/);
    expect(invoiceListPanel).toMatch(/customerCompanyId: string \| null/);
  });

  it("accepts activeView and onSelectionChange props", () => {
    expect(invoiceListPanel).toMatch(/activeView: InvoiceView/);
    expect(invoiceListPanel).toMatch(/onSelectionChange\?/);
  });

  it("renders with data-testid=invoice-list-panel", () => {
    expect(invoiceListPanel).toMatch(/data-testid="invoice-list-panel"/);
  });

  it("maps view=all to filter=all", () => {
    expect(invoiceListPanel).toMatch(/default.*return "all"/s);
  });

  it("maps view=overdue to filter=overdue", () => {
    expect(invoiceListPanel).toMatch(/case "overdue".*return "overdue"/s);
  });

  it("maps view=awaiting-payment to filter=awaiting_payment", () => {
    expect(invoiceListPanel).toMatch(/case "awaiting-payment".*return "awaiting_payment"/s);
  });

  it("maps view=drafts to filter=draft", () => {
    expect(invoiceListPanel).toMatch(/case "drafts".*return "draft"/s);
  });

  it("maps view=paid to filter=paid", () => {
    expect(invoiceListPanel).toMatch(/case "paid".*return "paid"/s);
  });

  it("resets filter and selection when activeView changes", () => {
    expect(invoiceListPanel).toMatch(/\[activeView\]/);
    expect(invoiceListPanel).toMatch(/setActiveFilter\(viewToFilter\(activeView\)\)/);
  });

  it("fetches invoices from /api/invoices/list", () => {
    expect(invoiceListPanel).toMatch(/\/api\/invoices\/list/);
  });

  it("fetches stats from /api/invoices/stats", () => {
    expect(invoiceListPanel).toMatch(/\/api\/invoices\/stats/);
  });

  it("fetches reconciliation data", () => {
    expect(invoiceListPanel).toMatch(/\/api\/invoices\/reconciliation/);
  });

  it("has bulk reminder mutation", () => {
    expect(invoiceListPanel).toMatch(/bulk-send-reminders/);
  });

  it("navigates to /invoices/:id on row click (existing behavior preserved)", () => {
    expect(invoiceListPanel).toMatch(/\/invoices\/\$\{invoice\.id\}/);
  });

  it("has search input", () => {
    expect(invoiceListPanel).toMatch(/data-testid="input-search-invoices"/);
  });

  it("does not carry a page header or h1 (workspace owns the header)", () => {
    expect(invoiceListPanel).not.toMatch(/<h1/);
  });

  it("SummaryCard metric value uses font-medium, not font-bold (canonical typography)", () => {
    expect(invoiceListPanel).toMatch(/text-page-title font-medium/);
    expect(invoiceListPanel).not.toMatch(/text-page-title font-bold/);
  });
});

// ── InsightsTab ──────────────────────────────────────────────────────

describe("InsightsTab", () => {
  it("shows coming-soon state; no mock financial data (Phase 2B stabilization)", () => {
    // Mock metrics removed — Insights tab now shows a coming-soon placeholder.
    expect(insightsTab).toMatch(/data-testid="insights-tab-coming-soon"/);
    expect(insightsTab).toMatch(/Coming soon/);
    expect(insightsTab).not.toMatch(/MOCK_METRICS/);
    expect(insightsTab).not.toMatch(/text-page-title font-semibold/);
  });
});

// ── Embedded mode — InvoicesListPage ────────────────────────────────

describe("InvoicesListPage embedded mode", () => {
  it("accepts embedded prop", () => {
    expect(invoicesListPage).toMatch(/embedded.*boolean/);
    expect(invoicesListPage).toMatch(/embedded = false/);
  });

  it("suppresses h1 in embedded mode", () => {
    expect(invoicesListPage).toMatch(/!embedded.*h1/s);
  });

  it("skips min-h-screen bg-app-bg shell when embedded", () => {
    // When embedded=true the component returns without the outer shell div
    expect(invoicesListPage).toMatch(/if \(embedded\)/);
    expect(invoicesListPage).toMatch(/min-h-screen bg-app-bg/);
  });

  it("renders InvoiceListPanel as the core content", () => {
    expect(invoicesListPage).toMatch(/InvoiceListPanel/);
    expect(invoicesListPage).toMatch(/<InvoiceListPanel/);
  });
});

// ── Embedded mode — PaymentsDashboardPage ───────────────────────────

describe("PaymentsDashboardPage embedded mode", () => {
  it("accepts embedded prop", () => {
    expect(paymentsDashPage).toMatch(/embedded.*boolean/);
    expect(paymentsDashPage).toMatch(/embedded = false/);
  });

  it("suppresses h1 in embedded mode via !embedded guard", () => {
    expect(paymentsDashPage).toMatch(/!embedded/);
    expect(paymentsDashPage).toMatch(/text-payments-dashboard-title/);
  });

  it("skips URL sync in embedded mode when setTab is called", () => {
    expect(paymentsDashPage).toMatch(/!embedded.*typeof window/);
  });
});

// ── PaymentsTab passes embedded prop ────────────────────────────────

describe("PaymentsTab", () => {
  it("renders PaymentsDashboardPage with embedded prop", () => {
    expect(paymentsTab).toMatch(/<PaymentsDashboardPage embedded/);
  });
});

// ── /invoices redirect ───────────────────────────────────────────────

describe("App.tsx routing", () => {
  it("/invoices redirects to /receivables (not /invoices directly)", () => {
    expect(appSrc).toMatch(/path="\/invoices"[\s\S]{0,200}Redirect to="\/receivables"/);
  });

  it("/invoices/new route still exists and renders NewInvoicePage", () => {
    expect(appSrc).toMatch(/path="\/invoices\/new"/);
    expect(appSrc).toMatch(/NewInvoicePage/);
  });

  it("/invoices/:id route still exists and renders InvoiceDetailPage", () => {
    expect(appSrc).toMatch(/path="\/invoices\/:id"/);
    expect(appSrc).toMatch(/InvoiceDetailPage/);
  });

  it("/receivables route renders ReceivablesPage", () => {
    expect(appSrc).toMatch(/path="\/receivables"/);
    expect(appSrc).toMatch(/ReceivablesPage/);
  });
});

// ── Sidebar ──────────────────────────────────────────────────────────

describe("AppSidebar", () => {
  it('sidebar item label is "Receivables"', () => {
    expect(sidebar).toMatch(/title: "Receivables"/);
  });

  it("sidebar item href is /receivables", () => {
    expect(sidebar).toMatch(/href: "\/receivables"/);
  });

  it("active state covers /receivables path", () => {
    expect(sidebar).toMatch(/location === "\/receivables"/);
  });

  it("active state covers /invoices/ sub-paths (detail pages)", () => {
    expect(sidebar).toMatch(/location\.startsWith\("\/invoices\/"\)/);
  });

  it("active state covers /invoices (the legacy redirect path)", () => {
    expect(sidebar).toMatch(/location === "\/invoices"/);
  });
});

// ── Dashboard filter links ────────────────────────────────────────────

describe("dashboardNavigation.ts filter links", () => {
  it("invoices.outstanding points to /receivables?tab=invoices&filter=awaiting_payment", () => {
    expect(dashNav).toMatch(/invoices\.outstanding.*pathname.*\/receivables/s);
    expect(dashNav).toMatch(/tab=invoices&filter=awaiting_payment/);
  });

  it("invoices.pastDue points to /receivables?tab=invoices&filter=overdue", () => {
    expect(dashNav).toMatch(/invoices\.pastDue.*pathname.*\/receivables/s);
    expect(dashNav).toMatch(/tab=invoices&filter=overdue/);
  });

  it("invoices.draft points to /receivables?tab=invoices&filter=draft", () => {
    expect(dashNav).toMatch(/invoices\.draft.*pathname.*\/receivables/s);
    expect(dashNav).toMatch(/tab=invoices&filter=draft/);
  });

  it("does NOT point to /invoices directly", () => {
    const invoiceLines = dashNav.match(/invoices\.(outstanding|pastDue|draft)[^\n]+/g) ?? [];
    for (const line of invoiceLines) {
      expect(line).not.toMatch(/pathname.*\/invoices"/);
    }
  });
});

describe("TopKpiRow overdue link", () => {
  it("points to /receivables?tab=invoices&filter=overdue", () => {
    expect(topKpi).toMatch(/href="\/receivables\?tab=invoices&filter=overdue"/);
  });

  it("does not point to /invoices?filter=overdue", () => {
    expect(topKpi).not.toMatch(/href="\/invoices\?filter=overdue"/);
  });
});

describe("RightColumnFinancialCards outstanding link", () => {
  it("ViewAllLink points to /receivables?tab=invoices&filter=outstanding", () => {
    expect(rightCol).toMatch(/href="\/receivables\?tab=invoices&filter=outstanding"/);
  });

  it("does not point to /invoices?filter=outstanding", () => {
    expect(rightCol).not.toMatch(/href="\/invoices\?filter=outstanding"/);
  });
});

// ── UniversalSearch navigation ───────────────────────────────────────

describe("UniversalSearch invoice navigation", () => {
  it("nav entries for invoices point to /receivables?tab=invoices", () => {
    expect(universalSearch).toMatch(/route.*\/receivables\?tab=invoices/);
  });

  it("does not have a stale /invoices route in nav commands", () => {
    const navBlock = universalSearch.match(/NAVIGATION_COMMANDS[\s\S]*?];/)?.[0] ?? "";
    expect(navBlock).not.toMatch(/route: "\/invoices"/);
  });

  it("individual invoice detail routes still point to /invoices/:id", () => {
    expect(universalSearch).toMatch(/invoice.*\/invoices\/\$\{id\}/s);
  });

  it('nav label for receivables workspace says "Receivables" or "Open Receivables"', () => {
    expect(universalSearch).toMatch(/label.*Receivables/);
  });
});

// ── Back button navigation ────────────────────────────────────────────

describe("InvoiceDetailPage back buttons", () => {
  it("back button navigates to /receivables?tab=invoices not /invoices", () => {
    expect(invoiceDetail).toMatch(/receivables\?tab=invoices/);
  });

  it("does not setLocation to bare /invoices", () => {
    const backCalls = invoiceDetail.match(/setLocation\("\/invoices[^/]/g) ?? [];
    expect(backCalls).toHaveLength(0);
  });
});

describe("NewInvoicePage back/cancel buttons", () => {
  it("back navigates to /receivables?tab=invoices", () => {
    expect(newInvoicePage).toMatch(/receivables\?tab=invoices/);
  });

  it("does not navigate back to bare /invoices", () => {
    const backCalls = newInvoicePage.match(/setLocationRoute\("\/invoices"\)/g) ?? [];
    expect(backCalls).toHaveLength(0);
  });
});

// ── Backward compatibility — old files removed ───────────────────────

describe("QueueTab removed", () => {
  it("QueueTab.tsx file does not exist", () => {
    const { existsSync } = require("fs");
    const { join: pathJoin } = require("path");
    expect(existsSync(pathJoin(ROOT, "client/src/pages/receivables/QueueTab.tsx"))).toBe(false);
  });
});

describe("InvoicesTab removed", () => {
  it("InvoicesTab.tsx file does not exist", () => {
    const { existsSync } = require("fs");
    const { join: pathJoin } = require("path");
    expect(existsSync(pathJoin(ROOT, "client/src/pages/receivables/InvoicesTab.tsx"))).toBe(false);
  });
});
