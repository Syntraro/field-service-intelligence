/**
 * Pricebook bulk picker — locks the canonical contract end-to-end.
 *
 * Two-tier coverage:
 *   1. Source-pin tests (the repo has no jsdom/RTL harness — see
 *      `tests/bulk-cleanup-card-copy.test.ts` header). Verifies the
 *      Pricebook button renders beside Add item, the modal mounts via
 *      ModalShell, the manual Add path is untouched, and the catalog
 *      UI surfaces read "Pricebook".
 *   2. Unit tests against the pure helpers in `pricebookHelpers.ts` —
 *      selection state machine + bulk submit mapping. The modal renders
 *      these helper outputs, so unit-testing them directly proves the
 *      selection / quantity / submit behavior the brief calls for
 *      ("clicking sets qty=1", "re-clicking increments not duplicates",
 *      "qty N → one line with quantity N", etc.) without RTL.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  clearSelection,
  decrementSelection,
  filterPricebookItems,
  incrementSelection,
  pricebookSubmitLabel,
  selectedCount,
  selectedTotal,
  selectionsToDrafts,
  type PricebookSelections,
} from "../client/src/components/line-items/pricebookHelpers";
import type { ProductOption } from "../client/src/lib/entities/productEntity";

const ROOT = resolve(__dirname, "..");
const MODAL_PATH = resolve(
  ROOT,
  "client/src/components/line-items/PricebookPickerModal.tsx",
);
const HELPERS_PATH = resolve(
  ROOT,
  "client/src/components/line-items/pricebookHelpers.ts",
);
const CARD_PATH = resolve(
  ROOT,
  "client/src/components/line-items/LineItemsCard.tsx",
);
const HOOK_PATH = resolve(
  ROOT,
  "client/src/components/line-items/useLineItemsDrafts.ts",
);
const ADD_FORM_PATH = resolve(
  ROOT,
  "client/src/components/line-items/AddLineItemForm.tsx",
);
const SETTINGS_PATH = resolve(ROOT, "client/src/pages/SettingsPage.tsx");
const TOOLBAR_PATH = resolve(
  ROOT,
  "client/src/components/products-services/ProductsServicesToolbar.tsx",
);
const IMPORT_CENTER_PATH = resolve(
  ROOT,
  "client/src/pages/ImportCenterPage.tsx",
);
const PARTS_BILLING_PATH = resolve(
  ROOT,
  "client/src/components/PartsBillingCard.tsx",
);

const modalSrc = readFileSync(MODAL_PATH, "utf-8");
const helpersSrc = readFileSync(HELPERS_PATH, "utf-8");
const cardSrc = readFileSync(CARD_PATH, "utf-8");
const hookSrc = readFileSync(HOOK_PATH, "utf-8");
const addFormSrc = readFileSync(ADD_FORM_PATH, "utf-8");
const settingsSrc = readFileSync(SETTINGS_PATH, "utf-8");
const toolbarSrc = readFileSync(TOOLBAR_PATH, "utf-8");
const importCenterSrc = readFileSync(IMPORT_CENTER_PATH, "utf-8");
const partsBillingSrc = readFileSync(PARTS_BILLING_PATH, "utf-8");

// ── Test fixtures ───────────────────────────────────────────────────

function makeItem(overrides: Partial<ProductOption> = {}): ProductOption {
  return {
    id: overrides.id ?? "item-1",
    name: overrides.name ?? "Diagnostic call",
    type: overrides.type ?? "service",
    unitPrice: overrides.unitPrice ?? "150.00",
    cost: overrides.cost ?? "50.00",
    sku: overrides.sku ?? null,
    category: overrides.category ?? null,
    description: overrides.description ?? null,
    estimatedDurationMinutes: overrides.estimatedDurationMinutes ?? null,
    isTaxable: overrides.isTaxable ?? true,
  };
}

const ITEMS: ProductOption[] = [
  makeItem({ id: "i1", name: "Diagnostic visit", unitPrice: "150.00", type: "service" }),
  makeItem({
    id: "i2",
    name: "Capacitor 45/5 mfd",
    unitPrice: "60.00",
    cost: "20.00",
    type: "product",
    description: "Run capacitor for residential AC condensers.",
    isTaxable: true,
  }),
  makeItem({
    id: "i3",
    name: "Annual maintenance",
    unitPrice: "299.00",
    cost: "75.00",
    type: "service",
    description: "Spring + fall PM bundle.",
  }),
];

// ── Selection state machine ─────────────────────────────────────────

describe("pricebookHelpers — selection state machine", () => {
  it("incrementSelection: clicking a non-selected item sets quantity to 1", () => {
    const next = incrementSelection(new Map(), "i1");
    expect(next.get("i1")).toBe(1);
    expect(selectedCount(next)).toBe(1);
  });

  it("incrementSelection: re-clicking the same item increments quantity (no duplicate row)", () => {
    let sel: PricebookSelections = new Map();
    sel = incrementSelection(sel, "i1");
    sel = incrementSelection(sel, "i1");
    sel = incrementSelection(sel, "i1");
    // Map still has ONE entry — re-clicking does not create a second
    // pending row, it bumps quantity.
    expect(sel.size).toBe(1);
    expect(sel.get("i1")).toBe(3);
  });

  it("decrementSelection: drops below 1 → item becomes unselected", () => {
    let sel: PricebookSelections = new Map([["i1", 1]]);
    sel = decrementSelection(sel, "i1");
    expect(sel.has("i1")).toBe(false);
    expect(selectedCount(sel)).toBe(0);
  });

  it("decrementSelection: above 1 → quantity decreases by 1", () => {
    const sel = decrementSelection(new Map([["i1", 3]]), "i1");
    expect(sel.get("i1")).toBe(2);
  });

  it("clearSelection: removes the item outright", () => {
    const sel = clearSelection(new Map([["i1", 5]]), "i1");
    expect(sel.has("i1")).toBe(false);
  });

  it("incrementSelection produces a new Map (immutable)", () => {
    const before = new Map([["i1", 1]]);
    const after = incrementSelection(before, "i1");
    expect(before.get("i1")).toBe(1); // untouched
    expect(after.get("i1")).toBe(2);
    expect(after).not.toBe(before);
  });
});

// ── Selected total + count ──────────────────────────────────────────

describe("pricebookHelpers — selected total + count", () => {
  it("selectedTotal multiplies quantity × unitPrice across the selection", () => {
    const sel: PricebookSelections = new Map([
      ["i1", 2], // 2 × 150 = 300
      ["i2", 3], // 3 × 60  = 180
    ]);
    expect(selectedTotal(sel, ITEMS)).toBeCloseTo(480, 2);
  });

  it("selectedTotal ignores items not in the catalog list (defensive)", () => {
    const sel: PricebookSelections = new Map([
      ["i1", 1],
      ["unknown", 5],
    ]);
    expect(selectedTotal(sel, ITEMS)).toBeCloseTo(150, 2);
  });

  it("selectedCount reports distinct selected items, not total quantity", () => {
    const sel: PricebookSelections = new Map([
      ["i1", 5],
      ["i2", 1],
    ]);
    expect(selectedCount(sel)).toBe(2);
  });
});

// ── Bulk submit mapping ─────────────────────────────────────────────

describe("pricebookHelpers — selectionsToDrafts (bulk submit)", () => {
  it("returns one draft per selected item with quantity preserved", () => {
    const sel: PricebookSelections = new Map([
      ["i1", 2],
      ["i3", 5],
    ]);
    const result = selectionsToDrafts(sel, ITEMS);
    // Two selections → exactly two drafts. Re-clicking i1 incremented
    // quantity but never produced a duplicate selection entry.
    expect(result).toHaveLength(2);
    const i1Draft = result.find((r) => r.product.id === "i1");
    const i3Draft = result.find((r) => r.product.id === "i3");
    expect(i1Draft).toBeTruthy();
    expect(i3Draft).toBeTruthy();
    // Quantity N becomes one line with quantity N.
    expect(i1Draft!.draft.quantity).toBe("2.00");
    expect(i3Draft!.draft.quantity).toBe("5.00");
  });

  it("each draft carries productId, unitPrice, unitCost, productType from the catalog", () => {
    const sel: PricebookSelections = new Map([["i2", 4]]);
    const [{ draft, product }] = selectionsToDrafts(sel, ITEMS);
    expect(draft.productId).toBe("i2");
    expect(draft.unitPrice).toBe("60.00");
    expect(draft.unitCost).toBe("20.00");
    expect(draft.productType).toBe("product");
    expect(product.id).toBe("i2");
  });

  it("computes lineSubtotal = quantity × unitPrice on each draft", () => {
    const sel: PricebookSelections = new Map([["i2", 4]]); // 4 × 60 = 240
    const [{ draft }] = selectionsToDrafts(sel, ITEMS);
    expect(draft.lineSubtotal).toBe("240.00");
    expect(draft.lineTotal).toBe("240.00");
  });

  it("description falls back through the canonical chain (name → catalog desc → sku)", () => {
    // i1 has no description; should fall back to name.
    const sel: PricebookSelections = new Map([["i1", 1]]);
    const [{ draft }] = selectionsToDrafts(sel, ITEMS);
    expect(draft.description).toBe("Diagnostic visit");
  });

  it("emits no drafts for an empty selection (submit-disabled guarantee)", () => {
    expect(selectionsToDrafts(new Map(), ITEMS)).toEqual([]);
  });

  it("skips selections whose item is no longer in the catalog list", () => {
    const sel: PricebookSelections = new Map([
      ["i1", 1],
      ["does-not-exist", 99],
    ]);
    const result = selectionsToDrafts(sel, ITEMS);
    expect(result).toHaveLength(1);
    expect(result[0].product.id).toBe("i1");
  });
});

// ── Submit label ────────────────────────────────────────────────────

describe("pricebookHelpers — submit label per caller", () => {
  it("invoice surface → Add to invoice", () => {
    expect(pricebookSubmitLabel("invoice")).toBe("Add to invoice");
  });

  it("quote surface → Add to quote", () => {
    expect(pricebookSubmitLabel("quote")).toBe("Add to quote");
    expect(pricebookSubmitLabel("quote-template")).toBe("Add to quote");
  });

  it("job surfaces → Add to job", () => {
    expect(pricebookSubmitLabel("job-parts")).toBe("Add to job");
    expect(pricebookSubmitLabel("job-template")).toBe("Add to job");
    expect(pricebookSubmitLabel("pm-template")).toBe("Add to job");
    expect(pricebookSubmitLabel("location-pm")).toBe("Add to job");
  });
});

// ── Search filter ───────────────────────────────────────────────────

describe("pricebookHelpers — search filter", () => {
  it("returns the full list when search is empty / whitespace", () => {
    expect(filterPricebookItems(ITEMS, "")).toHaveLength(3);
    expect(filterPricebookItems(ITEMS, "   ")).toHaveLength(3);
  });

  it("matches by name (case-insensitive)", () => {
    expect(filterPricebookItems(ITEMS, "diag")).toHaveLength(1);
    expect(filterPricebookItems(ITEMS, "DIAG")).toHaveLength(1);
  });

  it("matches by description / sku / category", () => {
    expect(filterPricebookItems(ITEMS, "capacitor")).toHaveLength(1);
    expect(filterPricebookItems(ITEMS, "PM bundle")).toHaveLength(1);
  });

  it("returns empty when nothing matches", () => {
    expect(filterPricebookItems(ITEMS, "no-such-thing")).toEqual([]);
  });
});

// ── Modal source contract ───────────────────────────────────────────

describe("PricebookPickerModal — modal source contract", () => {
  it("mounts the canonical ModalShell + Header / Footer primitives", () => {
    expect(modalSrc).toMatch(
      /from\s+"@\/components\/ui\/modal"/,
    );
    expect(modalSrc).toMatch(/<ModalShell\b/);
    expect(modalSrc).toMatch(/<ModalHeader\b/);
    expect(modalSrc).toMatch(/<ModalFooter\b/);
    expect(modalSrc).toMatch(/<ModalPrimaryAction\b/);
    expect(modalSrc).toMatch(/<ModalSecondaryAction\b/);
  });

  it("title, helper text, and search input read as the spec requires", () => {
    expect(modalSrc).toMatch(/>Pricebook</);
    expect(modalSrc).toMatch(/Select saved items to add them in bulk\./);
    expect(modalSrc).toMatch(/placeholder="Search pricebook items"/);
  });

  it("renders type badge, unit price, taxable indicator on each card", () => {
    expect(modalSrc).toMatch(/typeLabel/);
    expect(modalSrc).toMatch(/Service|Product/);
    expect(modalSrc).toMatch(/priceLabel/);
    expect(modalSrc).toMatch(/isTaxable/);
    // Description, when present, is clamped to 2 lines via -webkit-box.
    expect(modalSrc).toMatch(/WebkitLineClamp:\s*2/);
  });

  it("submit button is disabled when no items are selected", () => {
    expect(modalSrc).toMatch(/disabled=\{submitDisabled\}/);
    expect(modalSrc).toMatch(/const submitDisabled = itemCount === 0/);
  });

  it("submit handler routes through selectionsToDrafts and onOpenChange(false)", () => {
    expect(modalSrc).toMatch(/selectionsToDrafts\(selections,\s*serverItems\)/);
    expect(modalSrc).toMatch(/onSubmit\(entries\)/);
    expect(modalSrc).toMatch(/onOpenChange\(false\)/);
  });

  it("selection state resets only on close, not on search-text change", () => {
    // useEffect resets selection ONLY when `open` flips false. Search
    // changes do not appear in the dependency array.
    expect(modalSrc).toMatch(
      /useEffect\(\s*\(\)\s*=>\s*\{\s*if\s*\(!open\)/,
    );
    // Search updates do not call setSelections — selection state is
    // only mutated by handleToggleAdd / handleIncrement / etc.
    const searchHandler = modalSrc.match(/onChange=\{\(e\)\s*=>\s*setSearch\([^}]+\)\}/);
    expect(searchHandler).toBeTruthy();
  });

  it("loading / error / empty / search-empty branches are pinned", () => {
    expect(modalSrc).toMatch(/data-testid="pricebook-error"/);
    expect(modalSrc).toMatch(/data-testid="pricebook-empty"/);
    expect(modalSrc).toMatch(/data-testid="pricebook-empty-search"/);
    expect(modalSrc).toMatch(/<Skeleton\b/);
  });

  it("quantity controls expose +/− / quantity data-testids per item", () => {
    expect(modalSrc).toMatch(/pricebook-increment-/);
    expect(modalSrc).toMatch(/pricebook-decrement-/);
    expect(modalSrc).toMatch(/pricebook-quantity-/);
    // 2026-05-07 cleanup: explicit X/remove control removed.
    // Decrementing past 1 unselects via `decrementSelection`; an
    // explicit remove button was redundant and is intentionally gone.
    expect(modalSrc).not.toMatch(/pricebook-remove-/);
    expect(modalSrc).not.toMatch(/Remove\s+\$\{item\.name\}\s+from\s+selection/);
  });

  it("modal owns its own width (taxonomy rule #5 — ModalShell stays width-neutral)", () => {
    // Domain wrapper sets viewport-safe width + max on its ModalShell
    // instance; ModalShell itself remains untouched. The wrapper class
    // string carries an explicit `max-w-[1040px]` so the override
    // beats the base DialogContent's `max-w-lg`. The `min(...)`
    // expression keeps the modal inside narrow viewports without
    // horizontal scroll.
    expect(modalSrc).toMatch(/w-\[min\(1040px,calc\(100vw-32px\)\)\]/);
    expect(modalSrc).toMatch(/max-w-\[1040px\]/);
    expect(modalSrc).toMatch(/sm:max-w-\[1040px\]/);
  });

  it("modal shell sets an EXPLICIT height at sm:+, not only a max-height", () => {
    // 2026-05-07 default-height fix: shell must define its OWN height
    // so the body's `flex-1` has a parent size to distribute from.
    // `max-h` alone collapses the shell to content height when the
    // catalog is sparse (1–2 items) and the modal opens short.
    //
    // Required: `sm:h-[min(720px,calc(100vh-80px))]`. The `min(...)`
    // also acts as the viewport-safe cap so a separate max-h is
    // redundant.
    expect(modalSrc).toMatch(
      /sm:h-\[min\(720px,calc\(100vh-80px\)\)\]/,
    );
    // Negative pin — the prior `sm:max-h-` regression cannot return.
    // If a future refactor swaps `sm:h-…` back to `sm:max-h-…` the
    // modal will once again open short on sparse catalogs; this
    // assertion is the regression guard for that exact bug.
    expect(modalSrc).not.toMatch(
      /sm:max-h-\[min\(720px,calc\(100vh-80px\)\)\]/,
    );
  });

  it("modal body has an EXPLICIT min-height at sm:+ to reserve ≈3 rows", () => {
    // Body needs a min-height (or explicit height) at sm:+ so that
    // even if the shell's `flex-1` distribution misbehaves the body
    // still reserves room for three compact card rows. 480px ≈ 3 rows
    // of 140px-tall cards plus gap and padding.
    expect(modalSrc).toMatch(/sm:min-h-\[480px\]/);
    // Body still carries the viewport-aware max-h cap for the upper
    // bound; flex-1 distributes within the shell.
    expect(modalSrc).toMatch(
      /max-h-\[min\(620px,calc\(100vh-220px\)\)\]/,
    );
    // Source-line contract — pin the combined className shape so a
    // refactor that drops `flex-1` (and breaks scroll) fails loud.
    expect(modalSrc).toMatch(
      /flex-1 sm:min-h-\[480px\] max-h-\[min\(620px,calc\(100vh-220px\)\)\] overflow-y-auto/,
    );
    // Negative pin — body must NOT regress to a max-h-only contract
    // with no min reservation. The exact previous shape (no
    // `sm:min-h-` between flex-1 and max-h) is what produced the
    // short-modal bug.
    expect(modalSrc).not.toMatch(
      /flex-1 max-h-\[min\(620px,calc\(100vh-220px\)\)\] overflow-y-auto/,
    );
  });

  it("mobile (<sm) gets natural content height — no forced oversized modal", () => {
    // The brief explicitly excludes mobile from the forced-tall
    // behavior. Both height tokens are gated on `sm:` so phones see
    // the canonical natural-content-height modal with normal scroll.
    // A regression that drops the `sm:` prefix would force a 720px
    // modal on a 667px iPhone viewport.
    const shellClassMatch = modalSrc.match(
      /data-testid="pricebook-picker-modal"[\s\S]{0,80}/,
    );
    // The shell-height token is `sm:h-[…]`, never bare `h-[…]`.
    expect(modalSrc).not.toMatch(/(?<!:)\bh-\[min\(720px/);
    // The body's min token is `sm:min-h-[480px]`, never bare.
    expect(modalSrc).not.toMatch(/(?<!:)\bmin-h-\[480px\]/);
    expect(shellClassMatch).toBeTruthy();
  });

  it("sticky footer stays visible — shell uses flex-col, footer is the last block", () => {
    // The shell's `flex flex-col` layout pins the footer at the
    // bottom while the body owns the scroll. `<ModalFooter>` is the
    // last child inside `<ModalShell>` — pin both ends.
    expect(modalSrc).toMatch(/className="[^"]*flex flex-col[^"]*"/);
    // Source contract: the JSX `<ModalFooter className=...>` appears
    // AFTER the body block. Anchor on the JSX usage (className=) so
    // we don't pick up the JSDoc-header mention of `<ModalFooter>`.
    const footerIdx = modalSrc.indexOf("<ModalFooter className=");
    const bodyIdx = modalSrc.indexOf('data-testid="pricebook-body"');
    expect(bodyIdx).toBeGreaterThan(-1);
    expect(footerIdx).toBeGreaterThan(bodyIdx);
  });

  // 2026-05-07 polish — bulk-selection UX refinements ─────────────

  it("renders ONE canonical close button — no manual X duplicates the Radix one", () => {
    // `<DialogContent>` (which `<ModalShell>` wraps) auto-renders a
    // `<DialogPrimitive.Close>` with an X icon at `absolute right-4
    // top-4`. The earlier revision added a manual <Button> in the
    // header that produced a second visible X. Pin its absence so the
    // duplication doesn't regress.
    expect(modalSrc).not.toMatch(/data-testid="pricebook-close"/);
    // No raw <X> icon mounted inside the modal header (the Radix close
    // button lives in DialogContent itself, not inside ModalHeader).
    const headerBlock = modalSrc.match(
      /<ModalHeader\b[\s\S]+?<\/ModalHeader>/,
    );
    expect(headerBlock, "ModalHeader block must exist").toBeTruthy();
    expect(headerBlock![0]).not.toMatch(/<X\b/);
    // No "Close pricebook" aria-label inside the header — the canonical
    // Radix close handles its own aria, and we don't want to compete.
    expect(headerBlock![0]).not.toMatch(/aria-label="Close pricebook"/);
  });

  it("title block reserves space (`pr-8`) for the canonical X close button", () => {
    // Reserving padding-right on the title row prevents the title text
    // from sliding under the canonical close button. Without this the
    // visible title can overlap the Radix X on narrow widths.
    const headerBlock = modalSrc.match(
      /<ModalHeader\b[\s\S]+?<\/ModalHeader>/,
    );
    expect(headerBlock).toBeTruthy();
    expect(headerBlock![0]).toMatch(/pr-8/);
  });

  it("desktop grid uses CSS auto-fill / minmax(200px, 1fr) for ≈4-col layout", () => {
    // Brief: desktop ≈ 4 cols, tablet 2–3 cols, mobile 1 col, with
    // CSS Grid `auto-fill / minmax`. A 1040px modal divided by a
    // 200px minimum yields ≈4 columns on desktop / iPad landscape;
    // smaller viewports (iPad portrait, mobile) collapse automatically
    // without breakpoint thresholds. Tightened from 220px → 200px on
    // 2026-05-07 to guarantee 4-col density on iPad landscape.
    expect(modalSrc).toMatch(
      /gridTemplateColumns:\s*"repeat\(auto-fill,\s*minmax\(200px,\s*1fr\)\)"/,
    );
    // No remnants of the prior 220px grid spec.
    expect(modalSrc).not.toMatch(
      /gridTemplateColumns:\s*"repeat\(auto-fill,\s*minmax\(220px,\s*1fr\)\)"/,
    );
    // The same auto-fill rule drives the loading skeleton so density
    // is consistent across loading / loaded states.
    const skeletonBlock = modalSrc.match(/isLoading\s*\?[\s\S]+?:\s*isError/);
    expect(skeletonBlock).toBeTruthy();
    expect(skeletonBlock![0]).toMatch(
      /gridTemplateColumns:\s*"repeat\(auto-fill,\s*minmax\(200px,\s*1fr\)\)"/,
    );
  });

  it("no horizontal-overflow patterns slip in alongside the new viewport-safe width", () => {
    // Guard against future churn re-introducing fixed widths that
    // could blow past iPad-portrait viewport. The shell must NOT use
    // a raw `w-[1040px]` (no min() guard) or `w-screen`. Negative
    // lookbehind on `-` prevents the regex from matching inside
    // `max-w-[1040px]` / `sm:max-w-[1040px]` (those are fine; only a
    // bare `w-[1040px]` is a regression).
    expect(modalSrc).not.toMatch(/(?<!-)w-\[1040px\]/);
    expect(modalSrc).not.toMatch(/\bw-screen\b/);
    expect(modalSrc).not.toMatch(/\bmin-w-\[1040px\]/);
  });

  it("quantity controls render WITHOUT requiring a pre-selection click", () => {
    // The earlier two-mode card wrapped the body in a <button> that
    // had to be clicked first to "enter" selected mode before any
    // quantity controls appeared. Brief: drop that. Every card always
    // exposes a + (qty=0 → solo + button) and the trio (− qty +) once
    // qty>0. Pin: no enclosing wrapper <button> hides controls.
    const cardBlock = modalSrc.match(
      /const PricebookItemCard = memo\(function PricebookItemCard\([\s\S]+?\n\}\);/,
    );
    expect(cardBlock, "PricebookItemCard component must exist").toBeTruthy();
    const block = cardBlock![0];
    // Add button is always rendered (unselected branch); increment is
    // always rendered (selected branch). The two-mode `pricebook-add-`
    // wrapping <button> that hid the entire body is gone — `add-`
    // testid is now on the small + Button only.
    expect(block).toMatch(/data-testid=\{`pricebook-add-\$\{item\.id\}`\}/);
    expect(block).toMatch(/data-testid=\{`pricebook-increment-\$\{item\.id\}`\}/);
    expect(block).toMatch(/isSelected\s*\?\s*\([\s\S]+?\)\s*:\s*\(/);
    // The previous shape wrapped <PricebookItemBody> inside a top-level
    // <button onClick={onAdd}> for unselected state — that's gone.
    expect(block).not.toMatch(/<button[^>]+onClick=\{onAdd\}/);
    expect(block).not.toMatch(/PricebookItemBody/);
  });

  it("card is React.memo'd to prevent cross-card re-renders", () => {
    // Rapid-click bulk add is the picker's defining workflow. Without
    // memoization, a click on item A re-renders every other card too.
    // Pin: the card export is wrapped in `memo(...)` and the parent
    // hands stable callbacks (useCallback with []-deps).
    expect(modalSrc).toMatch(
      /const PricebookItemCard = memo\(function PricebookItemCard\(/,
    );
    // Parent uses functional updaters so the useCallback deps stay
    // empty — a [] dep array means the same function reference for
    // the whole modal lifetime.
    expect(modalSrc).toMatch(
      /const onIncrement = useCallback\(\(itemId: string\)\s*=>\s*\{[\s\S]+?\},\s*\[\]\);/,
    );
    expect(modalSrc).toMatch(
      /const onDecrement = useCallback\(\(itemId: string\)\s*=>\s*\{[\s\S]+?\},\s*\[\]\);/,
    );
    // 2026-05-07 cleanup: `onClear` callback removed alongside the
    // X/remove button — decrementing past 1 is the canonical unselect.
    expect(modalSrc).not.toMatch(
      /const onClear = useCallback\(/,
    );
  });

  it("compact card padding (`p-2.5`) — not the prior `p-3`", () => {
    const cardBlock = modalSrc.match(
      /const PricebookItemCard = memo\(function PricebookItemCard\([\s\S]+?\n\}\);/,
    );
    expect(cardBlock).toBeTruthy();
    expect(cardBlock![0]).toMatch(/p-2\.5/);
    // No remnants of the heavier original padding.
    expect(cardBlock![0]).not.toMatch(/\bp-3\b/);
  });
});

// ── Helpers source — guard the unit-tested module's public surface ──

describe("pricebookHelpers — public surface guard", () => {
  it("exports all the functions the modal + tests rely on", () => {
    expect(helpersSrc).toMatch(/export function incrementSelection\b/);
    expect(helpersSrc).toMatch(/export function decrementSelection\b/);
    expect(helpersSrc).toMatch(/export function clearSelection\b/);
    expect(helpersSrc).toMatch(/export function selectedTotal\b/);
    expect(helpersSrc).toMatch(/export function selectedCount\b/);
    expect(helpersSrc).toMatch(/export function selectionsToDrafts\b/);
    expect(helpersSrc).toMatch(/export function filterPricebookItems\b/);
    expect(helpersSrc).toMatch(/export function pricebookSubmitLabel\b/);
  });

  it("routes through the canonical catalogItemToDraft mapper (no parallel mapping)", () => {
    // Brief: "Use the existing line-item mapper/conversion logic if one
    // exists. Do not create a second competing line-item mapping system."
    expect(helpersSrc).toMatch(
      /import\s*\{[^}]*catalogItemToDraft[^}]*\}\s*from\s*"@\/lib\/entities\/lineItemMapper"/,
    );
    expect(helpersSrc).toMatch(
      /import\s*\{[^}]*productOptionToCatalogItem[^}]*\}\s*from\s*"@\/lib\/entities\/productEntity"/,
    );
  });
});

// ── LineItemsCard wiring ────────────────────────────────────────────

describe("LineItemsCard — Pricebook button wiring", () => {
  it("imports the PricebookPickerModal and tracks open state locally", () => {
    expect(cardSrc).toMatch(
      /import\s*\{\s*PricebookPickerModal\s*\}\s*from\s*"\.\/PricebookPickerModal"/,
    );
    expect(cardSrc).toMatch(/useState<boolean>?\(false\)|useState\(false\)/);
    expect(cardSrc).toMatch(/setPricebookOpen\(true\)/);
  });

  it("renders a Pricebook button beside the empty-state Add line item button", () => {
    expect(cardSrc).toMatch(/data-testid="button-empty-add-line"/);
    expect(cardSrc).toMatch(/data-testid="button-empty-pricebook"/);
    // Both buttons live inside the same flex row in the empty state.
    const emptyStateBlock = cardSrc.match(
      /button-empty-add-line[\s\S]+?button-empty-pricebook[\s\S]+?<\/div>/,
    );
    expect(emptyStateBlock).toBeTruthy();
  });

  it("renders a Pricebook button beside the edit-mode Add another line item button", () => {
    expect(cardSrc).toMatch(/data-testid="button-add-another-line-item"/);
    expect(cardSrc).toMatch(/data-testid="button-pricebook"/);
    // Edit-mode footer pairs them in the same flex row.
    const footerBlock = cardSrc.match(
      /button-add-another-line-item[\s\S]+?button-pricebook[\s\S]+?<\/div>/,
    );
    expect(footerBlock).toBeTruthy();
  });

  it("mounts the PricebookPickerModal once and threads adapter.surface through", () => {
    const matches = cardSrc.match(/<PricebookPickerModal\b/g) ?? [];
    expect(matches.length).toBe(1);
    expect(cardSrc).toMatch(/surface=\{adapter\.surface\}/);
  });

  it("submit handler routes through the canonical hook (appendMany, not appendNew loop)", () => {
    expect(cardSrc).toMatch(/drafts\.appendMany\(entries\)/);
    // The manual Add path still uses appendNew — pin its presence so a
    // refactor doesn't accidentally collapse the two flows.
    expect(cardSrc).toMatch(/drafts\.appendNew\(\)/);
  });

  it("existing manual Add line item flow is preserved for batched mode", () => {
    // 2026-05-07 Phase A: the empty-state Add button gained a
    // persisted-mode branch. The legacy `drafts.enterEdit() +
    // drafts.appendNew()` flow now lives inside the `else`
    // (batched) branch — pin the sequence still appears together
    // and an `isPersisted` guard is the gate.
    expect(cardSrc).toMatch(
      /isPersisted[\s\S]+?setAddModalOpen\(true\)[\s\S]+?\}\s*else\s*\{\s*drafts\.enterEdit\(\);\s*drafts\.appendNew\(\);\s*\}/,
    );
    // AddLineItemForm is still mounted (the per-row product picker).
    expect(cardSrc).toMatch(/<AddLineItemForm\b/);
    expect(addFormSrc).toMatch(/CreateOrSelectField/);
  });
});

// ── useLineItemsDrafts — appendMany contract ────────────────────────

describe("useLineItemsDrafts — appendMany bulk-add contract", () => {
  it("appendMany is exported from the hook return", () => {
    expect(hookSrc).toMatch(/const appendMany = useCallback/);
    expect(hookSrc).toMatch(/return\s*\{[\s\S]*appendMany,[\s\S]*\}/);
  });

  it("appendMany accepts an array and produces ONE entry per input draft", () => {
    // No looping over `appendNew` — single setDrafts spread.
    const block = hookSrc.match(
      /const appendMany = useCallback[\s\S]+?\}\,\s*\[\]\,\s*\);/,
    );
    expect(block).toBeTruthy();
    expect(block![0]).toMatch(/setDrafts\(\(prev\)\s*=>\s*\[/);
    expect(block![0]).toMatch(/entries\.map\(/);
    // Each entry → serverId: null (new row), full clientKey, no original.
    expect(block![0]).toMatch(/serverId:\s*null/);
    expect(block![0]).toMatch(/original:\s*null/);
  });

  it("appendMany short-circuits on an empty array", () => {
    expect(hookSrc).toMatch(/if\s*\(entries\.length === 0\)\s*return;/);
  });
});

// ── Catalog UI label rename — "Pricebook" ───────────────────────────

describe('Catalog UI labels read "Pricebook" (UI-only rename)', () => {
  it("Settings page shows the Pricebook card", () => {
    expect(settingsSrc).toMatch(/title:\s*"Pricebook"/);
    expect(settingsSrc).not.toMatch(
      /title:\s*"Products & Services",\s*description:\s*"Manage your product catalog"/,
    );
  });

  it("ProductsServicesToolbar heading + subhead read Pricebook", () => {
    expect(toolbarSrc).toMatch(/>Pricebook</);
    expect(toolbarSrc).toMatch(/Manage your saved products and services\./);
    // The old "Products & Services" page heading is gone.
    expect(toolbarSrc).not.toMatch(/>Products & Services</);
  });

  it("Import Center tab/label use Pricebook", () => {
    expect(importCenterSrc).toMatch(
      /key:\s*"products",\s*label:\s*"Pricebook",\s*tabLabel:\s*"Pricebook"/,
    );
  });

  it("PartsBillingCard inline copy references Pricebook", () => {
    expect(partsBillingSrc).toMatch(
      /This item will be added to your Pricebook/,
    );
    expect(partsBillingSrc).not.toMatch(
      /will be added to your Products & Services/,
    );
  });

  it('does NOT rename the generic "Line items" label', () => {
    // Brief: "Line items remains Line items." Pin that the shared card
    // default title is still "Line items" and the AddLineItemForm
    // placeholder is unchanged.
    expect(cardSrc).toMatch(/title\s*=\s*"Line items"/);
    expect(addFormSrc).toMatch(/Search product \/ service\.\.\./);
  });
});
