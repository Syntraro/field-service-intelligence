/**
 * Invoices not sent — bottom row of OperationalAlertsCard
 * (2026-05-07 consolidation).
 *
 * History
 * -------
 * - 2026-05-06: the standalone Needs Attention card was narrowed to a
 *   single row ("Invoices not sent") that opened the shared
 *   <DashboardActionModal mode="invoices_not_sent">.
 * - 2026-05-07: the standalone Needs Attention card was removed
 *   entirely. The "Invoices not sent" row was absorbed into the
 *   bottom of OperationalAlertsCard. Same shared modal, same source
 *   data, same canonical mode — only the host card moved.
 *
 * Locks the contract that:
 *   • The "Invoices not sent" row lives in OperationalAlertsCard with
 *     the canonical row key/mode `invoices_not_sent`.
 *   • The row routes to the SHARED <DashboardActionModal mode="invoices_not_sent">
 *     — no parallel invoice modal component is introduced.
 *   • The new mode reuses the canonical OperationalActionModal shell
 *     (same chrome / typography / footer rhythm as the four operational
 *     modes), the canonical /api/invoices/list feed (filtered to
 *     status=draft), and the canonical SendCommunicationModal for the
 *     Send action.
 *   • The retired NeedsAttentionCard does NOT come back.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, join } from "path";

const ROOT = resolve(__dirname, "..");
const MODAL_PATH = resolve(ROOT, "client/src/components/DashboardActionModal.tsx");
const DASHBOARD_PATH = resolve(ROOT, "client/src/pages/FinancialDashboard.tsx");
const ALERTS_CARD_PATH = resolve(ROOT, "client/src/components/dashboard/OperationalAlertsCard.tsx");
const INVOICES_ROUTE_PATH = resolve(ROOT, "server/routes/invoices.ts");
const REGISTRY_PATH = resolve(ROOT, "shared/dashboardWidgetRegistry.ts");

const modalSrc = readFileSync(MODAL_PATH, "utf-8");
const dashSrc = readFileSync(DASHBOARD_PATH, "utf-8");
const alertsCardSrc = readFileSync(ALERTS_CARD_PATH, "utf-8");
const invoicesRouteSrc = readFileSync(INVOICES_ROUTE_PATH, "utf-8");
const registrySrc = readFileSync(REGISTRY_PATH, "utf-8");

// ── Retired card stays retired ──────────────────────────────────────

describe("NeedsAttentionCard — retired (2026-05-07)", () => {
  it("the standalone card component is removed from the dashboard page", () => {
    expect(dashSrc).not.toMatch(/function NeedsAttentionCard\(/);
    expect(dashSrc).not.toMatch(/interface NeedsAttentionCardProps\b/);
    expect(dashSrc).not.toMatch(/<NeedsAttentionCard\b/);
  });

  it("the retired widget key is gone from the registry", () => {
    // The registry is the source of truth for what renders. Removing
    // the entry orphans persisted user-layout rows, but the resolver
    // iterates the registry (not the override rows) so old layouts
    // degrade safely.
    expect(registrySrc).not.toMatch(/key:\s*"needs_attention"/);
  });

  it("the page renderer map does not carry the needs_attention key", () => {
    expect(dashSrc).not.toMatch(/needs_attention:\s*\(/);
  });

  it("the prior in-card testids are gone (no orphaned card chrome)", () => {
    expect(dashSrc).not.toMatch(/data-testid="needs-attention"/);
    expect(dashSrc).not.toMatch(/data-testid="needs-attention-empty"/);
    expect(dashSrc).not.toMatch(/data-testid=\{`needs-attention-/);
  });
});

// ── Invoices not sent row lives in OperationalAlertsCard ────────────

describe("OperationalAlertsCard — Invoices not sent row (absorbed 2026-05-07)", () => {
  it("declares the invoices_not_sent row key in the OperationalAlertRowKey union", () => {
    expect(alertsCardSrc).toMatch(
      /export type OperationalAlertRowKey\s*=[\s\S]+?\|\s*"invoices_not_sent"/,
    );
  });

  it("accepts the optional invoicesNotSentCount prop with default 0", () => {
    // Optional so callers without the financial-summary query in scope
    // (e.g. the Operations dashboard, if it ever re-mounts this card)
    // can omit the prop and the row simply renders muted at 0.
    expect(alertsCardSrc).toMatch(/invoicesNotSentCount\?:\s*number/);
    expect(alertsCardSrc).toMatch(/invoicesNotSentCount\s*=\s*0/);
  });

  it("registers the invoices_not_sent row with the canonical mode + label + icon", () => {
    expect(alertsCardSrc).toMatch(
      /invoices_not_sent:\s*\{[\s\S]+?label:\s*"Invoices not sent"[\s\S]+?icon:\s*FileText[\s\S]+?mode:\s*"invoices_not_sent"/,
    );
  });

  it("places invoices_not_sent at the bottom of the canonical default order (lower urgency)", () => {
    // Canonical ordering puts billing-side items below
    // scheduling/dispatch items so highest operational urgency stays
    // at the top of the card.
    expect(alertsCardSrc).toMatch(
      /DEFAULT_ALERT_ORDER:\s*OperationalAlertRowKey\[\]\s*=\s*\[\s*"ready_to_invoice",\s*"past_due",\s*"unscheduled",\s*"requires_attention",\s*"invoices_not_sent",?\s*\]/,
    );
  });

  it("folds invoicesNotSentCount into the totalCount (so the card doesn't auto-collapse while billing waits)", () => {
    expect(alertsCardSrc).toMatch(
      /const totalCount\s*=\s*readyToInvoiceCount\s*\+\s*pastDueCount\s*\+\s*unscheduledCount\s*\+\s*requiresAttentionCount\s*\+\s*invoicesNotSentCount/,
    );
  });

  it("loading skeleton renders 5 rows (matches the 5 canonical row count)", () => {
    expect(alertsCardSrc).toMatch(/\[0,\s*1,\s*2,\s*3,\s*4\]\.map/);
  });
});

// ── Page wiring: count + handler thread through to OperationalAlertsCard ──

describe("FinancialDashboard — wires invoicesNotSentCount into OperationalAlertsCard", () => {
  it("threads the financial-summary count into OperationalAlertsCard", () => {
    // Same shape the retired NeedsAttentionCard consumed — no new
    // query, no new endpoint, no client-side aggregation.
    expect(dashSrc).toMatch(
      /<OperationalAlertsCard\b[\s\S]+?invoicesNotSentCount=\{data\?\.needsAttention\.invoicesNotSentCount\s*\?\?\s*0\}/,
    );
  });

  it("passes the 5-element canonical order with invoices_not_sent at the bottom", () => {
    expect(dashSrc).toMatch(
      /order=\{\["requires_attention", "past_due", "unscheduled", "ready_to_invoice", "invoices_not_sent"\]\}/,
    );
  });

  it("Operational Alerts is added to the financial query gate so its new row's data loads", () => {
    // Hidden-widget rule: the financial summary query must fire when
    // Operational Alerts is visible (because invoicesNotSentCount lives
    // on that summary), so the row never sticks at 0 when the workflow
    // query alone is enabled.
    //
    // Strip line comments inside the array literal so explanatory
    // prose (which legitimately references the retired key by name)
    // doesn't false-trigger the negative pin below.
    const queryGateBlock = dashSrc.match(
      /FINANCIAL_QUERY_WIDGETS:[\s\S]+?\];/,
    );
    expect(queryGateBlock).toBeTruthy();
    const codeOnly = queryGateBlock![0]
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(codeOnly).toMatch(/"operational_alerts"/);
    // Inverse pin: no string-literal entry for the retired key.
    expect(codeOnly).not.toMatch(/"needs_attention"/);
  });

  it("page state starts at requires_attention; the row → mode dispatch lives on OperationalAlertsCard", () => {
    // The default mode does not change — we still initialize on
    // requires_attention. After consolidation the literal
    // openActionModal("invoices_not_sent") call no longer lives on
    // the PAGE (the previous NeedsAttentionCard mount used it
    // directly); it now flows through OperationalAlertsCard's
    // onOpenActionModal(row.mode) where row.mode === "invoices_not_sent".
    expect(dashSrc).toMatch(/useState<DashboardActionMode>\("requires_attention"\)/);
    // Cross-check the alerts card carries the row + mode literal.
    expect(alertsCardSrc).toMatch(/mode:\s*"invoices_not_sent"/);
    // And the page wires openActionModal into the alerts card so the
    // dispatch reaches the modal.
    expect(dashSrc).toMatch(
      /<OperationalAlertsCard\b[\s\S]+?onOpenActionModal=\{openActionModal\}/,
    );
  });

  it("does NOT navigate to /invoices?filter=draft for the Invoices not sent View", () => {
    // The prior implementation called setLocation('/invoices?filter=draft').
    // That path is now superseded by the shared dashboard modal.
    expect(dashSrc).not.toMatch(/setLocation\("\/invoices\?filter=draft"\)/);
  });

  it("mounts the shared DashboardActionModal once (single JSX instance)", () => {
    // The page renders ONE <DashboardActionModal> element; mode switches
    // in place via setActionModalMode. Anchor on the actual JSX mount
    // by matching the mode prop binding (which only appears on the live
    // element, not in import statements or comment references).
    const matches = dashSrc.match(/<DashboardActionModal\b[\s\S]*?mode=\{actionModalMode\}/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("does NOT re-introduce duplicate invoice-row rendering on the page", () => {
    // After consolidation there must be exactly ONE place in the
    // dashboard tree where the "Invoices not sent" row is rendered:
    // the OperationalAlertsCard's row map. The old NeedsAttentionCard
    // location is gone.
    //
    // Strip comments first — explanatory in-source prose legitimately
    // mentions the absorbed-row label by name, and a substring count
    // would over-report.
    const codeOnly = dashSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/\/\/[^\n]*/g, "");
    // No `label: "Invoices not sent"` declaration on the page — the
    // row config moved to OperationalAlertsCard.
    expect(codeOnly).not.toMatch(/label:\s*"Invoices not sent"/);
    // The label literal lives in the alerts card now (single source).
    expect(alertsCardSrc).toMatch(/label:\s*"Invoices not sent"/);
    const cardMatches = alertsCardSrc.match(/label:\s*"Invoices not sent"/g) ?? [];
    expect(cardMatches.length).toBe(1);
  });
});

// ── Modal feed regression: invoices_not_sent must not 400 ──────────

describe("/api/invoices/list — lenient pagination (invoices_not_sent feed fix)", () => {
  it("uses parsePaginationLenient so callers can omit offset/cursor", () => {
    // Strict parsePagination throws 400 when both offset and cursor are
    // missing — which is exactly what the dashboard modal sends when it
    // calls `/api/invoices/list?status=draft&limit=50`. Lenient parsing
    // defaults offset=0 in that case so the feed loads.
    expect(invoicesRouteSrc).toMatch(
      /import\s*\{[^}]*parsePaginationLenient[^}]*\}\s*from\s*"\.\.\/utils\/pagination"/,
    );
    // The /list route specifically uses lenient parsing.
    const listBlock = invoicesRouteSrc.match(
      /router\.get\("\/list",\s*asyncHandler\(async[\s\S]+?\}\)\);/,
    );
    expect(listBlock, "/list route handler must exist").toBeTruthy();
    expect(listBlock![0]).toMatch(/parsePaginationLenient\(req\.query\)/);
    expect(listBlock![0]).not.toMatch(/parsePagination\(req\.query\)/);
    // The status passthrough still flows through to getInvoicesFeed.
    expect(listBlock![0]).toMatch(/status:\s*statusParam/);
  });

  it("the modal's exact query shape parses cleanly through the lenient parser", async () => {
    // `?status=draft&limit=50` is what `DashboardActionModal` sends for
    // the `unsent_invoices` source. Strict parsePagination would have
    // thrown HTTP 400 on this shape (the bug); lenient must default
    // offset=0 and return cleanly so the route reaches getInvoicesFeed.
    const { parsePaginationLenient } = await import(
      "../server/utils/pagination"
    );
    const result = parsePaginationLenient({ status: "draft", limit: "50" });
    expect(result.params.limit).toBe(50);
    expect(result.params.offset).toBe(0);
    expect(result.params.cursor).toBeUndefined();
    expect(result.explicit).toBe(true); // `limit` was passed explicitly
  });
});

// ── Modal: invoices_not_sent contract (unchanged) ───────────────────

describe("DashboardActionModal — invoices_not_sent mode wiring", () => {
  it("MODE_CONFIG.invoices_not_sent has title 'Invoices Not Sent' + sources=[unsent_invoices]", () => {
    const block = modalSrc.match(
      /invoices_not_sent:\s*\{[\s\S]+?\},/m,
    );
    expect(block, "MODE_CONFIG.invoices_not_sent must exist").toBeTruthy();
    const stripped = block![0]
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(stripped).toMatch(/title:\s*"Invoices Not Sent"/);
    expect(stripped).toMatch(/sources:\s*\["unsent_invoices"\]/);
  });

  it("registers the unsent_invoices internal source", () => {
    expect(modalSrc).toMatch(/"unsent_invoices"/);
    // Source URL hits the canonical invoices list with the status filter.
    expect(modalSrc).toMatch(
      /sourceUrl[\s\S]+?\/api\/invoices\/list\?\$\{SOURCE_PARAMS\.unsent_invoices\}/,
    );
    // Section label for the (single-source) mode header.
    expect(modalSrc).toMatch(/unsent_invoices:\s*"Invoices Not Sent"/);
  });

  it("renders ONLY unsent (status=draft) invoices in this mode", () => {
    // The query param is the contract — server enforces the
    // status=draft filter via getInvoicesFeed.
    expect(modalSrc).toMatch(/unsent_invoices:\s*"status=draft&limit=50"/);
    // Negative pin: this source must not silently expand to other
    // unpaid statuses (awaiting_payment, sent, partial_paid).
    expect(modalSrc).not.toMatch(
      /unsent_invoices:\s*"status=(?:awaiting_payment|sent|partial_paid|paid)/,
    );
    // The route layer accepts the status passthrough so the filter
    // actually reaches getInvoicesFeed.
    expect(invoicesRouteSrc).toMatch(/req\.query\.status/);
    expect(invoicesRouteSrc).toMatch(/status:\s*statusParam/);
  });

  it("each row exposes Send Invoice + Open Invoice actions", () => {
    expect(modalSrc).toMatch(
      /data-testid=\{`unsent-invoice-send-\$\{inv\.id\}`\}/,
    );
    expect(modalSrc).toMatch(
      /data-testid=\{`unsent-invoice-open-\$\{inv\.id\}`\}/,
    );
    // Action labels read as the spec requires.
    expect(modalSrc).toMatch(/>\s*Send Invoice\s*</);
    expect(modalSrc).toMatch(/Open Invoice\s*<ArrowUpRight/);
  });

  it("each row carries the spec'd metadata: invoice #, customer, amount, created date, status", () => {
    // Pin the row block once and assert all five fields land in it.
    const rowBlock = modalSrc.match(
      /function renderInvoiceRow\([\s\S]+?^\s{2}\}/m,
    );
    expect(rowBlock, "renderInvoiceRow must exist").toBeTruthy();
    const block = rowBlock![0];
    expect(block).toMatch(/inv\.invoiceNumber/);
    expect(block).toMatch(/locationDisplayName|locationName/);
    expect(block).toMatch(/inv\.total/);
    expect(block).toMatch(/inv\.createdAt/);
    expect(block).toMatch(/inv\.status/);
    // Status pill for visual scanning.
    expect(block).toMatch(/data-testid=\{`unsent-invoice-status-/);
  });

  it("renders the empty state when there are no unsent invoices", () => {
    // Spec'd copy for the modal's empty state.
    expect(modalSrc).toMatch(/No invoices waiting to be sent\./);
    expect(modalSrc).toMatch(/data-testid="dashboard-action-empty"/);
  });

  it("Open Invoice navigates to /invoices/:id and closes the modal", () => {
    expect(modalSrc).toMatch(
      /handleOpenChange\(false\);\s*setLocation\(`\/invoices\/\$\{inv\.id\}`\)/,
    );
  });

  it("Send Invoice mounts the canonical SendCommunicationModal (no fork)", () => {
    // Sub-modal mount mirrors the bulk-unschedule confirm pattern —
    // sibling under the OperationalActionModal, opens via a state id.
    expect(modalSrc).toMatch(
      /from\s+"@\/components\/communication\/SendCommunicationModal"/,
    );
    expect(modalSrc).toMatch(/<SendCommunicationModal\b[\s\S]+?entityType="invoice"/);
    expect(modalSrc).toMatch(/entityId=\{sendInvoiceId\}/);
    // The Send button on the row sets the sub-modal target.
    expect(modalSrc).toMatch(/setSendInvoiceId\(inv\.id\)/);
    // Reset on close so the next click gets a fresh modal.
    expect(modalSrc).toMatch(/setSendInvoiceId\(null\)/);
  });
});

// ── Reuse: no separate invoice modal component introduced ───────────

describe("No parallel invoice modal component introduced", () => {
  function collectSrcFiles(dir: string, acc: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (name === "node_modules" || name === "dist" || name === "build") continue;
        collectSrcFiles(full, acc);
      } else if (/\.(tsx?|jsx?)$/.test(name)) {
        acc.push(full);
      }
    }
    return acc;
  }

  it("no new InvoicesNotSentModal / DraftInvoicesModal component file exists", () => {
    const files = collectSrcFiles(resolve(ROOT, "client/src"));
    const offenders = files.filter((f) =>
      /InvoicesNotSentModal|DraftInvoicesModal|UnsentInvoicesModal/.test(f),
    );
    expect(offenders).toEqual([]);
  });

  it("the modal source mounts <OperationalActionModal> (shared chrome) — not a new shell", () => {
    expect(modalSrc).toMatch(/<OperationalActionModal\b/);
    // No new pattern wrapper invented for invoices.
    expect(modalSrc).not.toMatch(/<InvoicesActionModal\b/);
    expect(modalSrc).not.toMatch(/<DraftInvoicesModal\b/);
  });
});

// ── Layout persistence: orphan needs_attention rows degrade safely ──

describe("Persisted user layouts referencing the retired widget degrade safely", () => {
  it("the cleanup migration sweeps orphan needs_attention rows for hygiene", () => {
    const sql = readFileSync(
      resolve(ROOT, "migrations/2026_05_07_drop_needs_attention_widget.sql"),
      "utf-8",
    );
    expect(sql).toMatch(
      /DELETE FROM user_dashboard_widgets[\s\S]+?WHERE widget_key\s*=\s*'needs_attention'/i,
    );
  });

  it("the customize drawer iterates the registry, not persisted rows (orphans never render)", () => {
    // The drawer renders a row per widget the resolver returns, and the
    // resolver iterates the registry (see useDashboardLayout +
    // userDashboardWidgetsRepository.listForUser). A persisted
    // needs_attention row is silently ignored — there is no toggle to
    // re-enable a widget the registry no longer knows about.
    const drawer = readFileSync(
      resolve(ROOT, "client/src/dashboard/DashboardCustomizeDrawer.tsx"),
      "utf-8",
    );
    // Drawer reads from layout.widgets (the resolver output), not raw
    // override rows. Pin that the drawer never references the retired
    // widget key directly.
    expect(drawer).not.toMatch(/needs_attention/);
  });
});
