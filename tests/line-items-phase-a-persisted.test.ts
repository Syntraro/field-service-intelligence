/**
 * LineItems Phase A — persisted interaction model contract tests.
 *
 * The repo has no jsdom/RTL harness (see `tests/bulk-cleanup-card-copy
 * .test.ts` header), so this file pins behavior at the source level —
 * adapter shape, JSX guards, modal mounts, and call-site wiring — for
 * the new always-on row interaction the Phase A refactor introduces
 * on persisted detail pages (Invoice / Quote / Job Detail).
 *
 * What's locked here:
 *   1. The adapter contract carries `interactionMode` and the per-row
 *      methods (`addLine`, `updateLine`, `deleteLine`, `reorderLines`,
 *      `bulkAddLines`).
 *   2. Each persisted detail page sets `interactionMode: "persisted"`
 *      and wires the per-row methods to its existing mutation hooks.
 *   3. Each draft-entity page (CreateQuotePage / NewInvoicePage)
 *      explicitly declares `interactionMode: "batched"` — the legacy
 *      contract — so a future refactor can't accidentally flip them
 *      without deliberate code change.
 *   4. LineItemsCard branches on `interactionMode`:
 *      - persisted → no global pencil / Save / Cancel; row-level
 *        edit/delete; add via modal; drag fires reorderLines;
 *        Pricebook submits via bulkAddLines.
 *      - batched → legacy edit-mode pipeline preserved exactly.
 *   5. LineItemRow display branch supports row actions
 *      (`onEditClick`, `onDelete`) and the drag handle when
 *      `showDragHandle` is true.
 *   6. LineItemEditModal mounts the canonical ModalShell primitives
 *      and renders a context-aware title per surface + mode.
 *   7. Quote has no `reorderLines` (endpoint missing) — pinned as
 *      a known gap so a UI affordance can't be added without the
 *      backend route.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..");

const TYPES_PATH = resolve(ROOT, "client/src/components/line-items/types.ts");
const CARD_PATH = resolve(ROOT, "client/src/components/line-items/LineItemsCard.tsx");
const ROW_PATH = resolve(ROOT, "client/src/components/line-items/LineItemRow.tsx");
const MODAL_PATH = resolve(ROOT, "client/src/components/line-items/LineItemEditModal.tsx");
const HOOK_PATH = resolve(ROOT, "client/src/components/line-items/useLineItemsDrafts.ts");

const INVOICE_DETAIL_PATH = resolve(ROOT, "client/src/pages/InvoiceDetailPage.tsx");
const QUOTE_DETAIL_PATH = resolve(ROOT, "client/src/pages/QuoteDetailPage.tsx");
const JOB_DETAIL_PATH = resolve(ROOT, "client/src/pages/JobDetailPage.tsx");

const DRAFT_QUOTE_ADAPTER_PATH = resolve(
  ROOT,
  "client/src/components/quotes/draftQuoteLineItemsAdapter.ts",
);
const DRAFT_INVOICE_ADAPTER_PATH = resolve(
  ROOT,
  "client/src/components/invoice/draftInvoiceLineItemsAdapter.ts",
);

const typesSrc = readFileSync(TYPES_PATH, "utf-8");
const cardSrc = readFileSync(CARD_PATH, "utf-8");
const rowSrc = readFileSync(ROW_PATH, "utf-8");
const modalSrc = readFileSync(MODAL_PATH, "utf-8");
const hookSrc = readFileSync(HOOK_PATH, "utf-8");

const invoiceSrc = readFileSync(INVOICE_DETAIL_PATH, "utf-8");
const quoteSrc = readFileSync(QUOTE_DETAIL_PATH, "utf-8");
const jobSrc = readFileSync(JOB_DETAIL_PATH, "utf-8");

const draftQuoteSrc = readFileSync(DRAFT_QUOTE_ADAPTER_PATH, "utf-8");
const draftInvoiceSrc = readFileSync(DRAFT_INVOICE_ADAPTER_PATH, "utf-8");

// ── 1. Adapter contract ─────────────────────────────────────────────

describe("LineItemsAdapter — interactionMode + per-row methods", () => {
  it("declares optional interactionMode union", () => {
    expect(typesSrc).toMatch(
      /interactionMode\?:\s*"persisted"\s*\|\s*"batched"/,
    );
  });

  it("declares optional per-row mutation methods", () => {
    expect(typesSrc).toMatch(
      /addLine\?:\s*\(draft:\s*LineItemDraft\)\s*=>\s*Promise<void>/,
    );
    expect(typesSrc).toMatch(
      /updateLine\?:\s*\(serverId:\s*string,\s*draft:\s*LineItemDraft\)\s*=>\s*Promise<void>/,
    );
    expect(typesSrc).toMatch(
      /deleteLine\?:\s*\(serverId:\s*string\)\s*=>\s*Promise<void>/,
    );
    expect(typesSrc).toMatch(
      /reorderLines\?:\s*\(orderedServerIds:\s*string\[\]\)\s*=>\s*Promise<void>/,
    );
    expect(typesSrc).toMatch(
      /bulkAddLines\?:\s*\(drafts:\s*LineItemDraft\[\]\)\s*=>\s*Promise<void>/,
    );
  });
});

// ── 2. Persisted detail pages — adapter declarations ────────────────

describe("InvoiceDetailPage — persisted-mode adapter wiring", () => {
  it("declares interactionMode: 'persisted'", () => {
    expect(invoiceSrc).toMatch(/surface:\s*"invoice"/);
    expect(invoiceSrc).toMatch(/interactionMode:\s*"persisted"/);
  });

  it("wires per-row methods to existing mutation hooks (mutateAsync)", () => {
    expect(invoiceSrc).toMatch(
      /addLine:\s*async\s*\(draft\)\s*=>\s*\{[\s\S]+?addLineMutation\.mutateAsync\(draft\)/,
    );
    expect(invoiceSrc).toMatch(
      /updateLine:\s*async\s*\(serverId,\s*draft\)\s*=>\s*\{[\s\S]+?updateLineMutation\.mutateAsync\(\{\s*lineId:\s*serverId,\s*draft\s*\}\)/,
    );
    expect(invoiceSrc).toMatch(
      /deleteLine:\s*async\s*\(serverId\)\s*=>\s*\{[\s\S]+?deleteLineMutation\.mutateAsync\(serverId\)/,
    );
    expect(invoiceSrc).toMatch(
      /reorderLines:\s*async\s*\(orderedServerIds\)\s*=>\s*\{[\s\S]+?reorderLinesMutation\.mutateAsync/,
    );
    expect(invoiceSrc).toMatch(
      /bulkAddLines:\s*async\s*\(drafts\)\s*=>\s*\{[\s\S]+?Promise\.allSettled/,
    );
  });
});

describe("QuoteDetailPage — persisted-mode adapter wiring", () => {
  it("declares interactionMode: 'persisted'", () => {
    expect(quoteSrc).toMatch(/surface:\s*"quote"/);
    expect(quoteSrc).toMatch(/interactionMode:\s*"persisted"/);
  });

  it("wires addLine / updateLine / deleteLine / bulkAddLines", () => {
    expect(quoteSrc).toMatch(
      /addLine:\s*async\s*\(draft\)\s*=>\s*\{[\s\S]+?addLineMutation\.mutateAsync\(draft\)/,
    );
    expect(quoteSrc).toMatch(
      /updateLine:\s*async\s*\(serverId,\s*draft\)\s*=>\s*\{[\s\S]+?updateLineMutation\.mutateAsync/,
    );
    expect(quoteSrc).toMatch(
      /deleteLine:\s*async\s*\(serverId\)\s*=>\s*\{[\s\S]+?deleteLineMutation\.mutateAsync\(serverId\)/,
    );
    expect(quoteSrc).toMatch(
      /bulkAddLines:\s*async\s*\(drafts\)\s*=>\s*\{[\s\S]+?Promise\.allSettled/,
    );
  });

  it("does NOT define reorderLines (server endpoint missing)", () => {
    // allowReorder must stay false until /api/quotes/:id/lines/reorder
    // exists. Pin both — the absence of the method AND the false flag
    // — so a UI affordance can't slip in without the backend.
    expect(quoteSrc).toMatch(/allowReorder:\s*false/);
    // Quote adapter block (between the surface label and saveAll) has
    // no `reorderLines:` key.
    const adapterBlock = quoteSrc.match(
      /surface:\s*"quote"[\s\S]+?saveAll:/,
    );
    expect(adapterBlock, "Quote adapter block must exist").toBeTruthy();
    expect(adapterBlock![0]).not.toMatch(/reorderLines:/);
  });
});

describe("JobDetailPage — persisted-mode adapter wiring", () => {
  it("declares interactionMode: 'persisted' on the job-parts adapter", () => {
    expect(jobSrc).toMatch(/surface:\s*"job-parts"/);
    expect(jobSrc).toMatch(/interactionMode:\s*"persisted"/);
  });

  it("wires per-row methods to /api/jobs/:jobId/parts endpoints", () => {
    expect(jobSrc).toMatch(
      /addLine:\s*async\s*\(draft\)\s*=>\s*\{[\s\S]+?apiRequest[\s\S]+?\/api\/jobs\/\$\{jobId\}\/parts[\s\S]+?method:\s*"POST"/,
    );
    expect(jobSrc).toMatch(
      /updateLine:\s*async\s*\(serverId,\s*draft\)\s*=>\s*\{[\s\S]+?\/api\/jobs\/\$\{jobId\}\/parts\/\$\{serverId\}[\s\S]+?method:\s*"PUT"/,
    );
    expect(jobSrc).toMatch(
      /deleteLine:\s*async\s*\(serverId\)\s*=>\s*\{[\s\S]+?\/api\/jobs\/\$\{jobId\}\/parts\/\$\{serverId\}[\s\S]+?method:\s*"DELETE"/,
    );
    // Reorder uses the existing sortOrder payload shape.
    expect(jobSrc).toMatch(
      /reorderLines:\s*async\s*\(orderedServerIds\)\s*=>\s*\{[\s\S]+?\/api\/jobs\/\$\{jobId\}\/parts\/reorder[\s\S]+?method:\s*"PATCH"[\s\S]+?sortOrder/,
    );
  });

  it("preserves the legacy saveAll alongside the new per-row methods", () => {
    // Phase A keeps saveAll on persisted adapters as a safety net —
    // the LineItemsCard branch ignores it, but the adapter type
    // requires it and a future revert/toggle stays feasible.
    expect(jobSrc).toMatch(/saveAll:\s*async\s*\(plan\)/);
  });
});

// ── 3. Draft-entity adapters — explicit batched declaration ─────────

describe("Draft-entity adapters — explicit batched declaration", () => {
  it("draftQuoteLineItemsAdapter declares interactionMode: 'batched'", () => {
    expect(draftQuoteSrc).toMatch(/surface:\s*"quote"/);
    expect(draftQuoteSrc).toMatch(/interactionMode:\s*"batched"/);
  });

  it("draftInvoiceLineItemsAdapter declares interactionMode: 'batched'", () => {
    expect(draftInvoiceSrc).toMatch(/surface:\s*"invoice"/);
    expect(draftInvoiceSrc).toMatch(/interactionMode:\s*"batched"/);
  });

  it("draft adapters do NOT define addLine / updateLine / deleteLine / reorderLines", () => {
    // Draft flows depend on the legacy saveAll(plan) batch contract.
    // Per-row methods would short-circuit the page-owned mirror
    // reconciliation (CreateQuotePage / NewInvoicePage). Pin their
    // absence so a future refactor doesn't accidentally enable them.
    expect(draftQuoteSrc).not.toMatch(/\baddLine:/);
    expect(draftQuoteSrc).not.toMatch(/\bupdateLine:/);
    expect(draftQuoteSrc).not.toMatch(/\bdeleteLine:/);
    expect(draftQuoteSrc).not.toMatch(/\breorderLines:/);
    expect(draftInvoiceSrc).not.toMatch(/\baddLine:/);
    expect(draftInvoiceSrc).not.toMatch(/\bupdateLine:/);
    expect(draftInvoiceSrc).not.toMatch(/\bdeleteLine:/);
    expect(draftInvoiceSrc).not.toMatch(/\breorderLines:/);
  });
});

// ── 4. LineItemsCard — branching contract ────────────────────────────

describe("LineItemsCard — branches on adapter.interactionMode", () => {
  it("derives `isPersisted` from adapter.interactionMode", () => {
    expect(cardSrc).toMatch(
      /const interactionMode:\s*"persisted"\s*\|\s*"batched"\s*=\s*adapter\.interactionMode\s*\?\?\s*"batched"/,
    );
    expect(cardSrc).toMatch(/const isPersisted = interactionMode === "persisted"/);
  });

  it("legacy `editing` flag is forced false in persisted mode", () => {
    // Pin the guard so persisted mode can't accidentally route through
    // the edit-mode JSX branch (`editing && drafts.drafts ? <edit> :
    // <view>`).
    expect(cardSrc).toMatch(/const editing = !isPersisted && drafts\.editing/);
  });

  it("global pencil + Save/Cancel are gated on !isPersisted", () => {
    expect(cardSrc).toMatch(
      /\{!isPersisted\s*&&\s*!isLocked\s*&&\s*!editing\s*&&\s*!hidePencilButton\s*&&\s*\(/,
    );
    expect(cardSrc).toMatch(
      /\{!isPersisted\s*&&\s*!isLocked\s*&&\s*editing\s*&&\s*\(/,
    );
  });

  it("DnD handler in persisted mode fires adapter.reorderLines directly", () => {
    expect(cardSrc).toMatch(
      /if\s*\(isPersisted\)\s*\{[\s\S]+?adapter\.reorderLines\(orderedIds\)/,
    );
    // Persisted reorder ignores drafts.reorderLocal — the server is
    // the source of truth.
    const persistedBranch = cardSrc.match(
      /if\s*\(isPersisted\)\s*\{[\s\S]+?return;\s*\}/,
    );
    expect(persistedBranch).toBeTruthy();
    expect(persistedBranch![0]).not.toMatch(/drafts\.reorderLocal/);
  });

  it("empty-state Add button opens the modal in persisted mode (NOT enterEdit + appendNew)", () => {
    // The JSX block bracketed by `<Button` and the closing
    // `data-testid="button-empty-add-line"` carries the onClick
    // handler. JSX prop order is unspecified, so use a
    // wider-matching capture and assert the key behaviors land
    // inside it.
    const buttonIdx = cardSrc.indexOf('data-testid="button-empty-add-line"');
    expect(buttonIdx).toBeGreaterThan(-1);
    // Walk back ~600 chars to capture the surrounding <Button> JSX.
    const slice = cardSrc.slice(Math.max(0, buttonIdx - 600), buttonIdx + 50);
    expect(slice).toMatch(/onClick=\{\(\)\s*=>\s*\{/);
    expect(slice).toMatch(/setAddModalOpen\(true\)/);
    // Batched fallback (else branch) preserves the legacy flow.
    expect(slice).toMatch(/drafts\.enterEdit\(\);[\s\S]+?drafts\.appendNew\(\);/);
  });

  it("persisted-mode footer renders Add item + Pricebook (no Save/Cancel)", () => {
    expect(cardSrc).toMatch(
      /\{isPersisted\s*&&\s*!isLocked\s*&&\s*sortedServer\.length\s*>\s*0\s*&&\s*\(/,
    );
    expect(cardSrc).toMatch(/data-testid="button-add-line-item"/);
    // The footer block doesn't carry the Save/Cancel pair.
    const persistedFooter = cardSrc.match(
      /\{isPersisted[\s\S]+?<\/CardShellFooter>\s*\)\}/,
    );
    expect(persistedFooter).toBeTruthy();
    expect(persistedFooter![0]).not.toMatch(/data-testid="button-save-lines/);
    expect(persistedFooter![0]).not.toMatch(/data-testid="button-cancel-lines/);
  });

  it("rows expose row actions only in persisted mode", () => {
    expect(cardSrc).toMatch(
      /onEditClick=\{\s*isPersisted\s*\?\s*\(\)\s*=>\s*setEditingLineId\(line\.id\)\s*:\s*undefined\s*\}/,
    );
    expect(cardSrc).toMatch(
      /onDelete=\{\s*isPersisted\s*\?\s*\(\)\s*=>\s*setPendingDeleteId\(line\.id\)\s*:\s*undefined\s*\}/,
    );
    expect(cardSrc).toMatch(
      /showDragHandle=\{isPersisted\s*&&\s*adapter\.allowReorder\}/,
    );
  });

  it("Pricebook submit fans out via adapter.bulkAddLines in persisted mode", () => {
    expect(cardSrc).toMatch(
      /if\s*\(isPersisted\)\s*\{\s*void\s+handlePersistedBulkAdd\(entries\.map\(\(e\)\s*=>\s*e\.draft\)\)/,
    );
    // Helper falls back to addLine fan-out when bulkAddLines isn't
    // provided, but never re-enters edit-mode.
    expect(cardSrc).toMatch(
      /const handlePersistedBulkAdd[\s\S]+?adapter\.bulkAddLines[\s\S]+?adapter\.addLine\(draft\)/,
    );
    // Batched fallback preserves the legacy flow.
    expect(cardSrc).toMatch(
      /if\s*\(!drafts\.editing\)\s*drafts\.enterEdit\(\);\s*drafts\.appendMany\(entries\)/,
    );
  });

  it("mounts LineItemEditModal + AlertDialog only in persisted mode", () => {
    expect(cardSrc).toMatch(
      /\{isPersisted\s*&&\s*\(\s*<>[\s\S]+?<LineItemEditModal\b[\s\S]+?mode="add"/,
    );
    expect(cardSrc).toMatch(
      /<LineItemEditModal\b[\s\S]+?mode="edit"/,
    );
    expect(cardSrc).toMatch(/<AlertDialog\b/);
    expect(cardSrc).toMatch(/data-testid="button-delete-line-confirm"/);
    expect(cardSrc).toMatch(/data-testid="button-delete-line-cancel"/);
  });
});

// ── 5. LineItemRow — display-mode action support ────────────────────

describe("LineItemRow — display branch supports row actions", () => {
  it("accepts onEditClick prop (in addition to existing onDelete)", () => {
    expect(rowSrc).toMatch(/onEditClick\?:\s*\(\)\s*=>\s*void/);
  });

  it("renders the drag handle in the display branch when showDragHandle is true", () => {
    // The handle was previously edit-mode only; pin the display
    // branch carries the same `<GripVertical>` block guarded on the
    // prop. Anchor on the start-of-display-branch comment and the
    // end-of-display-branch closing fragment (`</tr>` followed by
    // closing of the function and the EditCells divider).
    const startIdx = rowSrc.indexOf("// ── Display branch");
    expect(startIdx).toBeGreaterThan(-1);
    const editCellsIdx = rowSrc.indexOf("EditCells — internal");
    expect(editCellsIdx).toBeGreaterThan(startIdx);
    const displayBlock = rowSrc.slice(startIdx, editCellsIdx);
    expect(displayBlock).toMatch(/showDragHandle\s*&&\s*\(/);
    expect(displayBlock).toMatch(/<GripVertical/);
    expect(displayBlock).toMatch(
      /data-testid=\{`drag-handle-\$\{clientKey\}`\}/,
    );
  });

  it("makes the whole row a click target for edit (no standalone Edit button)", () => {
    // 2026-05-07 polish: the visible Edit pencil was removed in
    // favor of row-click-to-edit. Pin the absence so it can't slip
    // back, AND pin the row-level click contract.
    expect(rowSrc).not.toMatch(/data-testid=\{`button-edit-line-/);
    expect(rowSrc).not.toMatch(/aria-label="Edit line item"/);
    // The <tr> is the click target.
    expect(rowSrc).toMatch(/onClick=\{isClickable\s*\?\s*handleRowClick\s*:\s*undefined\}/);
    expect(rowSrc).toMatch(/role=\{isClickable\s*\?\s*"button"\s*:\s*undefined\}/);
    expect(rowSrc).toMatch(/tabIndex=\{isClickable\s*\?\s*0\s*:\s*undefined\}/);
  });

  it("renders Delete button (still) when onDelete is provided", () => {
    expect(rowSrc).toMatch(
      /data-testid=\{`button-delete-line-\$\{displayLine\.id\}`\}/,
    );
    expect(rowSrc).toMatch(/aria-label="Delete line item"/);
  });

  it("drag handle and delete button stop click propagation to the row", () => {
    // Drag-cell click stopPropagation prevents drag mousedown from
    // also firing row's onClick.
    expect(rowSrc).toMatch(
      /<td[\s\S]+?border-r border-border\/40[\s\S]+?onClick=\{\(e\)\s*=>\s*e\.stopPropagation\(\)\}/,
    );
    // Delete button stopPropagation prevents delete-click from also
    // opening the edit modal.
    expect(rowSrc).toMatch(
      /onClick=\{\(e\)\s*=>\s*\{\s*e\.stopPropagation\(\);\s*onDelete\(\);\s*\}\}/,
    );
  });

  it("drag-handle cell carries a visible right-edge divider", () => {
    expect(rowSrc).toMatch(/border-r border-border\/40/);
  });
});

// ── 6. LineItemEditModal — modal contract ────────────────────────────

describe("LineItemEditModal — shared add/edit modal contract", () => {
  it("mounts the canonical ModalShell + Header / Footer primitives", () => {
    expect(modalSrc).toMatch(/from\s+"@\/components\/ui\/modal"/);
    expect(modalSrc).toMatch(/<ModalShell\b/);
    expect(modalSrc).toMatch(/<ModalHeader\b/);
    expect(modalSrc).toMatch(/<ModalFooter\b/);
    expect(modalSrc).toMatch(/<ModalPrimaryAction\b/);
    expect(modalSrc).toMatch(/<ModalSecondaryAction\b/);
  });

  it("title is context-aware via lineItemEditModalTitle helper", () => {
    // Source uses template literals — the runtime strings ("Add
    // invoice item" etc.) never appear as literals in the source.
    // Pin the helper's structural shape: the noun lookup carries
    // all three surface labels, and the return statement composes
    // "Add ${noun}" / "Edit ${noun}".
    expect(modalSrc).toMatch(/export function lineItemEditModalTitle/);
    const startIdx = modalSrc.indexOf("export function lineItemEditModalTitle");
    expect(startIdx).toBeGreaterThan(-1);
    // Helper is short — capture ~600 chars including its body.
    const helperBlock = modalSrc.slice(startIdx, startIdx + 600);
    expect(helperBlock).toMatch(/"invoice item"/);
    expect(helperBlock).toMatch(/"quote item"/);
    expect(helperBlock).toMatch(/"job item"/);
    expect(helperBlock).toMatch(/`Add \$\{noun\}`/);
    expect(helperBlock).toMatch(/`Edit \$\{noun\}`/);
  });

  it("renders qty / cost / rate inputs (cost gated on showCost)", () => {
    expect(modalSrc).toMatch(/data-testid="line-item-edit-qty"/);
    expect(modalSrc).toMatch(/data-testid="line-item-edit-price"/);
    expect(modalSrc).toMatch(/showCost\s*&&\s*\(/);
    expect(modalSrc).toMatch(/data-testid="line-item-edit-cost"/);
  });

  it("Save is disabled until description (or product fallback) + qty>0", () => {
    expect(modalSrc).toMatch(/const canSave/);
    expect(modalSrc).toMatch(/finalDescription\.length\s*>\s*0\s*&&\s*quantity\s*>\s*0/);
    expect(modalSrc).toMatch(/disabled=\{!canSave\}/);
  });

  it("Cancel does not invoke onSave", () => {
    const cancelBlock = modalSrc.match(
      /<ModalSecondaryAction[\s\S]+?onClick=\{\(\)\s*=>\s*onOpenChange\(false\)\}/,
    );
    expect(cancelBlock, "Cancel must close without saving").toBeTruthy();
    // Sanity: Save handler is bound to `handleSubmit`, NOT the Cancel
    // button — pin both endpoints.
    expect(modalSrc).toMatch(
      /<ModalPrimaryAction\b[\s\S]+?onClick=\{handleSubmit\}/,
    );
  });

  it("routes saved-item application through the canonical lineItemMapper helpers", () => {
    // 2026-05-07: handleSelectProduct now delegates to
    // `applyCatalogItemToDraft` (canonical mapper helper) instead of
    // calling `catalogItemToDraft` inline. Both helpers live in the
    // same canonical mapper module — the contract here is that the
    // modal does NOT hand-build a setDraft object literal in its
    // selector callback (the file-level mapper guardrail).
    expect(modalSrc).toMatch(
      /import\s*\{\s*applyCatalogItemToDraft\s*\}\s*from\s*"@\/lib\/entities\/lineItemMapper"/,
    );
    expect(modalSrc).toMatch(/applyCatalogItemToDraft\(/);
  });

  it("recomputes lineSubtotal at save time (mirrors hook's buildSavePlan rule)", () => {
    expect(modalSrc).toMatch(
      /const subtotal = formatMoney\(quantity\s*\*\s*parseMoney\(draft\.unitPrice\)\)/,
    );
    expect(modalSrc).toMatch(/lineSubtotal:\s*subtotal/);
    expect(modalSrc).toMatch(/lineTotal:\s*subtotal/);
  });
});

// ── 7. useLineItemsDrafts — preserved exactly ────────────────────────

describe("useLineItemsDrafts — preserved untouched for batched flows", () => {
  it("still exposes the legacy edit-mode API (drafts/editing/save/cancel/...)", () => {
    expect(hookSrc).toMatch(/const enterEdit = useCallback/);
    expect(hookSrc).toMatch(/const cancel = useCallback/);
    expect(hookSrc).toMatch(/const save = useCallback/);
    expect(hookSrc).toMatch(/const appendNew = useCallback/);
    expect(hookSrc).toMatch(/const appendMany = useCallback/);
    expect(hookSrc).toMatch(/const updateDraft = useCallback/);
    expect(hookSrc).toMatch(/const reorderLocal = useCallback/);
    expect(hookSrc).toMatch(/const buildSavePlan = useCallback/);
  });

  it("headerMetrics still computes from drafts when editing, serverItems otherwise", () => {
    expect(hookSrc).toMatch(/const headerMetrics:\s*HeaderMetrics/);
    expect(hookSrc).toMatch(/drafts\s*\?[\s\S]+?:\s*serverItems\.map/);
  });
});

// ── 8. Reorder persistence by surface ───────────────────────────────

describe("Reorder persistence by surface", () => {
  it("Invoice — allowReorder=true AND reorderLines wired to existing endpoint", () => {
    expect(invoiceSrc).toMatch(/allowReorder:\s*true/);
    expect(invoiceSrc).toMatch(
      /reorderLinesMutation\.mutateAsync\(orderData\)/,
    );
  });

  it("Job Parts — allowReorder=true AND reorderLines hits /parts/reorder", () => {
    expect(jobSrc).toMatch(/allowReorder:\s*true/);
    expect(jobSrc).toMatch(/\/api\/jobs\/\$\{jobId\}\/parts\/reorder/);
  });

  it("Quote — allowReorder=false AND no reorderLines defined (deferred)", () => {
    expect(quoteSrc).toMatch(/allowReorder:\s*false/);
    // Deferred follow-up: backend must add POST /api/quotes/:id/lines/reorder
    // before this can flip to true.
  });
});
