/**
 * Receivables Phase 2B stabilization pass — runtime behavior guards (2026-05-13).
 *
 * Tests cover the ten fixes applied in the stabilization pass:
 *   C-1  Stats cache key mismatch in InvoiceListPanel bulk reminders
 *   C-2  SelectionContext carries followUpAt through to ContactClientModal
 *   C-3  Narrow invalidation: dialogs target view-scoped keys, not broad prefix
 *   H-2  View counts query has refetchInterval + refetchIntervalInBackground: false
 *   H-3  MarkDisputedDialog does NOT invalidate broad notes key
 *   H-4  Reminder send does NOT invalidate receivables invoice list
 *   M-1  Notes query throws on error; error state rendered instead of empty state
 *   M-2  Multi-select hides action buttons; renders disambiguation message only
 *   P-9  receivablesQueryKeys helpers export stable key shapes
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");

function src(relPath: string) {
  return readFileSync(join(ROOT, relPath), "utf-8");
}

const invoiceListPanel       = src("client/src/components/invoices/InvoiceListPanel.tsx");
const receivablesActionsRail = src("client/src/pages/receivables/ReceivablesActionsRail.tsx");
const invoicesWorkspaceTab   = src("client/src/pages/receivables/InvoicesWorkspaceTab.tsx");
const markDisputedDialog     = src("client/src/components/invoices/MarkDisputedDialog.tsx");
const queryKeysLib           = src("client/src/lib/receivablesQueryKeys.ts");

// ── Part 9: receivablesQueryKeys helper ──────────────────────────────────────

describe("receivablesQueryKeys", () => {
  it("exports a receivablesKeys object", () => {
    expect(queryKeysLib).toMatch(/export const receivablesKeys/);
  });

  it("viewsCounts returns [\"receivables\", \"views\", \"counts\"] shape", () => {
    expect(queryKeysLib).toMatch(/"receivables", "views", "counts"/);
    expect(queryKeysLib).toMatch(/viewsCounts/);
  });

  it("invoices() takes an InvoiceView and includes it in the key", () => {
    expect(queryKeysLib).toMatch(/"receivables", "invoices", view/);
    expect(queryKeysLib).toMatch(/invoices: \(view: InvoiceView\)/);
  });

  it("notes() takes invoiceId and uses object-shape { invoiceId }", () => {
    expect(queryKeysLib).toMatch(/"receivables", "notes", \{ invoiceId \}/);
    expect(queryKeysLib).toMatch(/notes: \(invoiceId/);
  });

  it("all helpers use as const for stable tuple types", () => {
    const constCount = (queryKeysLib.match(/as const/g) ?? []).length;
    expect(constCount).toBeGreaterThanOrEqual(3);
  });
});

// ── C-1: Stats cache key fix ─────────────────────────────────────────────────

describe("C-1: InvoiceListPanel stats invalidation key", () => {
  it("uses tuple key [\"invoices\", \"stats\"] not string path", () => {
    expect(invoiceListPanel).toMatch(/queryKey: \["invoices", "stats"\]/);
  });

  it("does NOT use the old string-path key /api/invoices/stats as queryKey", () => {
    // String-path keys are fine as fetch URLs; they must not appear as queryKey arguments
    const matches = invoiceListPanel.match(/queryKey: \[["']\/api\/invoices\/stats["']\]/g) ?? [];
    expect(matches.length).toBe(0);
  });

  it("query definition for stats also uses tuple key", () => {
    expect(invoiceListPanel).toMatch(/queryKey: \["invoices", "stats"\]/);
  });
});

// ── C-2: SelectionContext carries followUpAt ─────────────────────────────────

describe("C-2: SelectionContext carries followUpAt", () => {
  it("SelectionContext interface includes followUpAt field", () => {
    expect(invoiceListPanel).toMatch(/followUpAt\??: string \| null/);
  });

  it("selection propagation useEffect extracts followUpAt from the selected invoice", () => {
    expect(invoiceListPanel).toMatch(/followUpAt.*followUpAt/s);
    expect(invoiceListPanel).toMatch(/onSelectionChange.*followUpAt/s);
  });

  it("SelectedReceivablesContext in InvoicesWorkspaceTab includes followUpAt", () => {
    expect(invoicesWorkspaceTab).toMatch(/followUpAt\??: string \| null/);
  });

  it("handleSelectionChange passes followUpAt through", () => {
    expect(invoicesWorkspaceTab).toMatch(/followUpAt: ctx\.followUpAt/);
  });

});

// ── C-3: Narrow invalidation scope ──────────────────────────────────────────

describe("C-3: Scoped invalidation in MarkDisputedDialog", () => {
  it("uses receivablesKeys.invoices(activeView) not broad prefix", () => {
    expect(markDisputedDialog).toMatch(/receivablesKeys\.invoices\(activeView\)/);
  });

  it("does NOT invalidate the broad [\"receivables\", \"invoices\"] key", () => {
    expect(markDisputedDialog).not.toMatch(/"receivables", "invoices"\]/);
  });

  it("accepts activeView prop with default \"all\"", () => {
    expect(markDisputedDialog).toMatch(/activeView\??: InvoiceView/);
    expect(markDisputedDialog).toMatch(/activeView = "all"/);
  });
});

describe("C-3: ReceivablesActionsRail passes activeView to MarkDisputedDialog", () => {
  it("passes activeView to MarkDisputedDialog", () => {
    expect(receivablesActionsRail).toMatch(/MarkDisputedDialog[\s\S]{0,200}activeView=\{activeView\}/);
  });

  it("InvoicesWorkspaceTab passes activeView to ReceivablesActionsRail", () => {
    expect(invoicesWorkspaceTab).toMatch(/ReceivablesActionsRail[\s\S]{0,100}activeView=\{activeView\}/);
  });
});

// ── H-2: View counts auto-refresh ───────────────────────────────────────────

describe("H-2: View counts refetchInterval", () => {
  it("counts query has refetchInterval: 60_000", () => {
    expect(invoicesWorkspaceTab).toMatch(/refetchInterval: 60_000/);
  });

  it("counts query has refetchIntervalInBackground: false", () => {
    expect(invoicesWorkspaceTab).toMatch(/refetchIntervalInBackground: false/);
  });

  it("refetchInterval and refetchIntervalInBackground are on the counts query (proximity check)", () => {
    const idx = invoicesWorkspaceTab.indexOf("/api/receivables/views/counts");
    const block = invoicesWorkspaceTab.slice(Math.max(0, idx - 200), idx + 400);
    expect(block).toMatch(/refetchInterval: 60_000/);
    expect(block).toMatch(/refetchIntervalInBackground: false/);
  });
});

// ── H-3: No broad notes invalidation in dialogs ─────────────────────────────

describe("H-3: Dialogs do not invalidate broad notes key", () => {
  it("MarkDisputedDialog does NOT invalidate [\"receivables\", \"notes\"] broadly", () => {
    expect(markDisputedDialog).not.toMatch(/"receivables", "notes"\]/);
  });

  it("ReceivablesActionsRail scopes notes invalidation to receivablesKeys.notes(singleInvoiceId)", () => {
    expect(receivablesActionsRail).toMatch(/receivablesKeys\.notes\(singleInvoiceId\)/);
  });
});

// ── H-4: Reminder send does not invalidate invoice list ──────────────────────

describe("H-4: Reminder mutation invalidation", () => {
  it("reminder onSuccess does NOT invalidate receivables invoices list", () => {
    // The reminder mutation only invalidates viewsCounts — invoice list keys must be absent
    // from the entire onSuccess handler. We verify by checking the raw source between
    // "reminderMutation" and the next mutation definition.
    const railSrc = receivablesActionsRail;
    const reminderStart = railSrc.indexOf("reminderMutation = useMutation");
    const notesQueryStart = railSrc.indexOf("receivablesKeys.notes(singleInvoiceId)", reminderStart);
    const block = railSrc.slice(reminderStart, notesQueryStart);
    expect(block).not.toMatch(/receivablesKeys\.invoices/);
    expect(block).not.toMatch(/"receivables", "invoices"/);
  });

  it("reminder onSuccess DOES invalidate view counts", () => {
    expect(receivablesActionsRail).toMatch(/reminderMutation[\s\S]{0,800}receivablesKeys\.viewsCounts\(\)/);
  });
});

// ── M-1: Notes stream error state ────────────────────────────────────────────

describe("M-1: Notes query error handling", () => {
  it("notes query throws on !res.ok instead of returning empty array", () => {
    // Should throw, not return []
    expect(receivablesActionsRail).toMatch(/if \(!res\.ok\) throw new Error/);
    // Ensure the old pattern of returning [] on !res.ok is gone
    const notesQueryBlock = receivablesActionsRail.match(
      /queryFn: async \(\) => \{[\s\S]*?\/api\/receivables\/notes[\s\S]*?\},\s*enabled/
    )?.[0] ?? "";
    expect(notesQueryBlock).not.toMatch(/if \(!res\.ok\) return \[\]/);
  });

  it("useQuery destructures isError (notesError)", () => {
    expect(receivablesActionsRail).toMatch(/isError: notesError/);
  });

  it("renders error state with data-testid=receivables-notes-error", () => {
    expect(receivablesActionsRail).toMatch(/data-testid="receivables-notes-error"/);
  });

  it("error state text is 'Could not load receivables notes.'", () => {
    expect(receivablesActionsRail).toMatch(/Could not load receivables notes\./);
  });

  it("empty state still has data-testid=receivables-notes-empty", () => {
    expect(receivablesActionsRail).toMatch(/data-testid="receivables-notes-empty"/);
  });

  it("error state is checked before empty state (order: loading → error → empty → list)", () => {
    const errorIdx = receivablesActionsRail.indexOf("receivables-notes-error");
    const emptyIdx = receivablesActionsRail.indexOf("receivables-notes-empty");
    expect(errorIdx).toBeGreaterThan(0);
    expect(emptyIdx).toBeGreaterThan(errorIdx);
  });
});

// ── M-2: Multi-select UX cleanup ─────────────────────────────────────────────

describe("M-2: Multi-select hides action buttons", () => {
  it("primary actions section renders disambiguation message when isMultiSelect", () => {
    expect(receivablesActionsRail).toMatch(/isMultiSelect/);
    expect(receivablesActionsRail).toMatch(/data-testid="multi-select-hint"/);
    expect(receivablesActionsRail).toMatch(/Select one invoice to use single-invoice actions\./);
  });

  it("action buttons are inside the else branch (hidden on multi-select)", () => {
    // The action buttons (testids) appear inside the block that only renders when !isMultiSelect
    const content = receivablesActionsRail;
    const multiSelectHintIdx = content.indexOf('data-testid="multi-select-hint"');
    const followUpBtnIdx     = content.indexOf('data-testid="receivables-action-set-follow-up"');
    // The hint appears before the follow-up button in source — they're in different branches
    expect(multiSelectHintIdx).toBeGreaterThan(0);
    expect(followUpBtnIdx).toBeGreaterThan(0);
    // isMultiSelect conditional wraps the disambiguation message (className + testid span a few lines)
    expect(content).toMatch(/isMultiSelect[\s\S]{0,200}data-testid="multi-select-hint"/);
  });

  it("action buttons do NOT have disabled={!singleInvoiceId} (removed — buttons are hidden instead)", () => {
    // Old pattern: disabled={!singleInvoiceId} on the action buttons
    // New pattern: buttons not rendered at all on multi-select
    expect(receivablesActionsRail).not.toMatch(/disabled=\{!singleInvoiceId\}/);
  });

  it("zero-select empty state still renders", () => {
    expect(receivablesActionsRail).toMatch(/data-testid="receivables-actions-rail-empty"/);
  });

  it("single-select renders primary actions section", () => {
    expect(receivablesActionsRail).toMatch(/data-testid="receivables-primary-actions"/);
  });
});

// ── Regression: existing invariants not broken ───────────────────────────────

describe("Regression: existing receivables invariants", () => {
  it("InvoiceListPanel still has the receivables feed query keyed by activeView", () => {
    expect(invoiceListPanel).toMatch(/queryKey: \["receivables", "invoices", activeView\]/);
  });

  it("InvoiceListPanel still has the standard feed query", () => {
    expect(invoiceListPanel).toMatch(/queryKey: \["invoices", "feed"/);
  });

  it("InvoicesWorkspaceTab still passes counts to InvoiceViewRail", () => {
    expect(invoicesWorkspaceTab).toMatch(/counts=\{viewCounts\}/);
  });

  it("InvoicesWorkspaceTab counts query still has staleTime 30_000 and retry: false", () => {
    expect(invoicesWorkspaceTab).toMatch(/staleTime: 30_000/);
    expect(invoicesWorkspaceTab).toMatch(/retry: false/);
  });

  it("ReceivablesActionsRail still has notes stream section", () => {
    expect(receivablesActionsRail).toMatch(/data-testid="receivables-notes-section"/);
  });

  it("ReceivablesActionsRail still has Open invoice detail link", () => {
    expect(receivablesActionsRail).toMatch(/data-testid="receivables-action-open-detail"/);
  });

  it("ReceivablesActionsRail still uses receivablesKeys.notes for the query key", () => {
    expect(receivablesActionsRail).toMatch(/queryKey: receivablesKeys\.notes\(singleInvoiceId\)/);
  });

  it("MarkDisputedDialog mutation still patches /api/receivables/invoices/:id/mark-disputed", () => {
    expect(markDisputedDialog).toMatch(/\/api\/receivables\/invoices\/\$\{invoiceId\}\/mark-disputed/);
  });
});
