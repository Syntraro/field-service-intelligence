/**
 * Needs Attention narrowing + invoices_not_sent mode (2026-05-06 RALPH).
 *
 * Locks the contract that:
 *   • Needs Attention surfaces ONLY actionable billing/admin items.
 *     Quote follow-up, stale leads, and payments-pending are dropped.
 *   • The "Invoices not sent" View routes through the SHARED
 *     <DashboardActionModal mode="invoices_not_sent"> — no parallel
 *     invoice modal component is introduced.
 *   • The new mode reuses the canonical OperationalActionModal shell
 *     (same chrome / typography / footer rhythm as the four operational
 *     modes), the canonical /api/invoices/list feed (filtered to
 *     status=draft), and the canonical SendCommunicationModal for the
 *     Send action.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, join } from "path";

const ROOT = resolve(__dirname, "..");
const MODAL_PATH = resolve(ROOT, "client/src/components/DashboardActionModal.tsx");
const DASHBOARD_PATH = resolve(ROOT, "client/src/pages/FinancialDashboard.tsx");
const INVOICES_ROUTE_PATH = resolve(ROOT, "server/routes/invoices.ts");

const modalSrc = readFileSync(MODAL_PATH, "utf-8");
const dashSrc = readFileSync(DASHBOARD_PATH, "utf-8");
const invoicesRouteSrc = readFileSync(INVOICES_ROUTE_PATH, "utf-8");

/**
 * Extract the NeedsAttentionCard function source — from its `function`
 * declaration up to (but not including) the next top-level `function`
 * declaration in the file. The naive `[\s\S]+?^}/m` regex stops at the
 * destructured-params close-brace, so use a forward-anchored slice instead.
 */
function needsAttentionBlock(src: string): string {
  const start = src.indexOf("function NeedsAttentionCard(");
  expect(start, "NeedsAttentionCard function must exist").toBeGreaterThan(-1);
  const rest = src.slice(start + "function NeedsAttentionCard(".length);
  // The next top-level function (e.g. `TodaysScheduleCard`) is the
  // unambiguous boundary in this file.
  const nextFn = rest.search(/\nfunction\s+\w+\s*\(/);
  return src.slice(start, start + (nextFn > 0 ? nextFn : rest.length));
}

const naBlock = needsAttentionBlock(dashSrc);

// ── Needs Attention card narrowing ──────────────────────────────────

describe("NeedsAttentionCard — narrowed to billing/admin only", () => {
  it("removes the quote-follow-up row", () => {
    expect(naBlock).not.toMatch(/Quotes not followed up/);
    expect(naBlock).not.toMatch(/quotesNotFollowedUp/);
  });

  it("removes the stale-leads row", () => {
    // The schema field on the FinancialSummary interface MAY still carry
    // leadsNotConvertedCount (other surfaces may consume it). The CARD
    // body must not reference it though.
    expect(naBlock).not.toMatch(/Stale leads/);
    expect(naBlock).not.toMatch(/leadsNotConverted/);
    expect(naBlock).not.toMatch(/staleLeads/);
  });

  it("removes any payments-pending row", () => {
    expect(naBlock).not.toMatch(/payments_pending/i);
    expect(naBlock).not.toMatch(/Payments pending/i);
    expect(naBlock).not.toMatch(/Payments processing/i);
  });

  it("renders the empty state copy verbatim when no items are actionable", () => {
    expect(naBlock).toMatch(/No billing\/admin items need attention\./);
    expect(naBlock).toMatch(/data-testid="needs-attention-empty"/);
  });

  it("typography avoids text-[10px] / text-[11px] inside the card", () => {
    expect(naBlock).not.toMatch(/text-\[10px\]/);
    expect(naBlock).not.toMatch(/text-\[11px\]/);
    // Positive pin: the card uses the readable text-xs / text-sm tokens
    // (matches Operational Alerts + Collections rhythm).
    expect(naBlock).toMatch(/text-sm/);
    expect(naBlock).toMatch(/text-xs/);
  });
});

// ── Needs Attention row layout polish (2026-05-06 RALPH polish) ─────

describe("NeedsAttentionCard — compact single-line clickable rows", () => {
  it("does not render an inline View button or `-view` testid in the card", () => {
    // Row is now the click target itself, not a wrapper around a View button.
    expect(naBlock).not.toMatch(/>\s*View\s*</);
    expect(naBlock).not.toMatch(/-view"/);
  });

  it("each row is a <button> bound to its onView handler", () => {
    expect(naBlock).toMatch(/<button\b/);
    expect(naBlock).toMatch(/onClick=\{it\.onView\}/);
    // Empty bucket → button is disabled. Native <button> + `disabled`
    // gives us tabIndex / Enter / Space and a free muted state.
    expect(naBlock).toMatch(/disabled=\{!hasItems\}/);
  });

  it("count renders to the right of the label inside the row", () => {
    const labelIdx = naBlock.indexOf("{it.label}");
    const countIdx = naBlock.indexOf("{it.count}");
    expect(labelIdx).toBeGreaterThan(-1);
    expect(countIdx).toBeGreaterThan(-1);
    expect(labelIdx).toBeLessThan(countIdx);
    // Count carries the Operational-Alerts / Pipeline numeric style.
    expect(naBlock).toMatch(/text-sm font-semibold tabular-nums/);
    // Label is the flex-1 element pushing the count to the right edge.
    expect(naBlock).toMatch(/flex-1 text-xs font-medium truncate/);
  });

  it("density matches Pipeline / Operational Alerts (px-3 py-1.5 gap-2, single-line)", () => {
    expect(naBlock).toMatch(/px-3 py-1\.5/);
    expect(naBlock).toMatch(/gap-2/);
    // Two-line affordances from the previous shape are gone.
    expect(naBlock).not.toMatch(/flex-wrap/);
    expect(naBlock).not.toMatch(/items-baseline/);
    // Currency rendering is dropped from the compact card row per the brief.
    expect(naBlock).not.toMatch(/formatCurrency/);
    expect(naBlock).not.toMatch(/invoicesNotSentValue/);
  });

  it("hover + focus styling is visible on active rows", () => {
    expect(naBlock).toMatch(/hover:bg-\[#F0F5F0\]/);
    expect(naBlock).toMatch(/focus-visible:/);
  });

  it("zero-count row is muted but still renders the label + count", () => {
    expect(naBlock).toMatch(/hasItems\s*\?\s*"text-slate-700"\s*:\s*"text-slate-400"/);
    expect(naBlock).toMatch(/hasItems\s*\?\s*"text-\[#111827\]"\s*:\s*"text-slate-400"/);
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

// ── Wiring: View → DashboardActionModal mode=invoices_not_sent ──────

describe("FinancialDashboard — Invoices not sent View opens shared modal", () => {
  it("page state starts at requires_attention and routes invoices_not_sent through openActionModal", () => {
    // The default mode does not change — we still initialize on
    // requires_attention. The Invoices not sent button is just one of
    // the modes the page can switch to.
    expect(dashSrc).toMatch(/useState<DashboardActionMode>\("requires_attention"\)/);
    expect(dashSrc).toMatch(
      /onViewInvoicesNotSent=\{\(\)\s*=>\s*openActionModal\("invoices_not_sent"\)\}/,
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
});

// ── Modal: invoices_not_sent contract ───────────────────────────────

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
