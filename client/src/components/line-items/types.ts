/**
 * Canonical line-items types.
 *
 * 2026-04-29 (Phase 1) — extracted from InvoiceDetailPage. Surfaces an
 * adapter contract that future surfaces (Quote, Job Parts) can implement
 * without touching the shared shell. Invoice consumes these directly.
 *
 * The shared shell (`<LineItemsCard>`) standardizes:
 *   - card chrome
 *   - header metrics (revenue / cost / profit / margin)
 *   - empty state CTA
 *   - add / edit / delete UX
 *   - product/service selector
 *   - row spacing + input sizing
 *   - optional description progressive disclosure
 *
 * Per-surface adapters carry:
 *   - save routes (Promise strategy + payload shape)
 *   - tax rules (read-only badge vs. full editor — invoice today is
 *     read-only at the row level; tax cascade lives in the totals slot)
 *   - discount rules (rendered via `renderTotalsFooter` slot)
 *   - lifecycle locks (status / QBO / paid)
 *   - PDF / client-visibility links (rendered via slots)
 *   - surface-specific totals
 */
import type { ReactNode } from "react";
import type { LineItemDraft } from "@shared/lineItem";
import type { ProductOption } from "@/lib/entities/productEntity";

// ──────────────────────────────────────────────────────────────────────
// Draft entry
// ──────────────────────────────────────────────────────────────────────

export interface LineDraftEntry {
  /** Stable key for React lists + dnd-kit + per-row callbacks. For
   *  hydrated server rows this is the server id; for new drafts it is
   *  a synthetic `new-<uuid>` value. */
  clientKey: string;
  /** Server row id, or null for unsaved draft rows. */
  serverId: string | null;
  /** Live editable draft. Mutated via the hook's setters. */
  draft: LineItemDraft;
  /** Hydrated server snapshot at edit-mode entry. Drives the
   *  carry-over diff on product change AND the "is-this-row-dirty"
   *  check in the save planner. Null for new draft rows. */
  original: LineItemDraft | null;
  /** True when the user has marked an existing row for deletion. The
   *  hook keeps the entry visible-with-strikethrough is up to the row
   *  component; the save plan emits a delete promise. New (serverId =
   *  null) rows are removed from the list outright when discarded. */
  isDeleted: boolean;
  /** Transient UI state — selected product chip for the row. */
  uiSelectedProduct?: ProductOption | null;
  /** Transient UI state — true when the textarea content was
   *  auto-filled from the catalog (vs. user-typed). Used to clear the
   *  description on Change without nuking user-typed text. */
  uiDescriptionFromProduct?: boolean;
  /** Transient UI state — controls progressive disclosure of the
   *  description textarea. Hidden when false; the row shows a small
   *  "+ Add description" link instead. */
  uiShowDescription?: boolean;
}

// ──────────────────────────────────────────────────────────────────────
// Save plan
// ──────────────────────────────────────────────────────────────────────

export interface SavePlan {
  creates: LineItemDraft[];
  updates: { serverId: string; draft: LineItemDraft }[];
  deletes: string[];
  /** Optional — only emitted when the adapter sets `allowReorder` AND
   *  the local draft order differs from the original server order
   *  among persisted rows. */
  reorder?: { serverIds: string[] };
  /** 2026-04-29 (Phase 3): Full ordered list of non-deleted entries in
   *  their final position. Surfaces (like Job Parts) that fire reorder
   *  whenever new rows exist need this so they can build a reorder
   *  payload that includes BOTH persisted server ids AND newly-created
   *  rows (translated via a local→server id map built during the create
   *  pass in saveAll). Invoice and Quote ignore this field. */
  entriesInFinalOrder: LineDraftEntry[];
  /** Adapter-visible counters for telemetry / toast text. */
  skipped: number;
}

export interface SaveResult {
  ok: boolean;
  failures: number;
  skipped: number;
}

// ──────────────────────────────────────────────────────────────────────
// Header metrics
// ──────────────────────────────────────────────────────────────────────

export interface HeaderMetrics {
  /** Sum of qty × unitPrice across non-deleted entries. */
  revenue: number;
  /** Sum of qty × unitCost across non-deleted entries. Defaults to 0
   *  when no row carries unitCost — quote / invoice surfaces without
   *  a persisted cost column still produce a valid (revenue, margin)
   *  pair instead of silently dropping the Profit + Profit Margin
   *  tiles. The shared LineItemsCard renders all three tiles whenever
   *  revenue > 0. */
  cost: number;
  /** revenue − cost. Equals `revenue` when cost is 0. */
  profit: number;
  /** profit / revenue × 100. Returns 0 when revenue ≤ 0; the card
   *  uses revenue > 0 as the show / hide gate so the tile cluster
   *  doesn't render when there are no lines at all. */
  margin: number;
}

// ──────────────────────────────────────────────────────────────────────
// Adapter contract
// ──────────────────────────────────────────────────────────────────────

export interface LineItemsAdapter<TServerLine = any> {
  /** Identifies the surface for telemetry / debugging. */
  surface: "invoice" | "quote" | "job-parts" | "job-template" | "quote-template" | "pm-template" | "location-pm";

  /**
   * 2026-05-07 Phase A — interaction model.
   *
   *   • `"persisted"`  — Always-visible rows on a real, saved entity.
   *     LineItemsCard renders rows directly from `serverItems`, exposes
   *     row-level Edit + Delete + drag actions, and fires the per-row
   *     methods below for each user action. NO global edit-mode UI on
   *     the card (no pencil, no Save/Cancel).
   *   • `"batched"`    — Legacy edit-mode workflow used by draft-entity
   *     pages (CreateQuotePage / NewInvoicePage). Card renders the
   *     pencil → drafts → Save/Cancel cycle and `useLineItemsDrafts`
   *     batches everything into `saveAll(plan)`. Phase A intentionally
   *     keeps this shape alive — those pages own a `serverItemsMirror`
   *     state machine that depends on it.
   *
   * Default if omitted: `"batched"` for backwards compatibility — the
   * three persisted detail pages (invoice / quote / job) declare this
   * explicitly to opt in to the new model.
   */
  interactionMode?: "persisted" | "batched";

  // ── Per-row mutation methods (interactionMode === "persisted" only) ──
  //
  // The card's persisted branch fires these directly per user action.
  // Each method should: (a) hit the existing canonical mutation, (b)
  // resolve when the server confirms and the query cache is invalidated.
  // Errors should be re-thrown so the modal/AlertDialog can surface
  // them via toast in the surface page.

  /** Add ONE new line. Modal-driven add fires this on Save. */
  addLine?: (draft: LineItemDraft) => Promise<void>;
  /** Update ONE existing line. Modal-driven edit fires this on Save. */
  updateLine?: (serverId: string, draft: LineItemDraft) => Promise<void>;
  /** Delete ONE existing line. Row delete fires this after the
   *  AlertDialog confirms. */
  deleteLine?: (serverId: string) => Promise<void>;
  /** Persist a new ordering of the existing rows. Drag-end fires this
   *  immediately. Optional — surfaces without a reorder endpoint
   *  (Quote today) MUST set `allowReorder: false` and omit this. */
  reorderLines?: (orderedServerIds: string[]) => Promise<void>;
  /** Bulk add from the Pricebook picker. Default fan-out is N x
   *  `addLine`; surfaces with a single bulk endpoint can override. */
  bulkAddLines?: (drafts: LineItemDraft[]) => Promise<void>;

  // Capability flags — drive UI conditionals in the shell + row.
  /** Render the per-row Cost column. Job Parts = true; Invoice/Quote = false. */
  showCost: boolean;
  /** Reserved for future per-row tax editing. Invoice today: tax is
   *  cascade-only and rendered in the totals slot, not the row. Defaults
   *  false. */
  showTax: boolean;
  /** Allow DnD reorder. Invoice + Job Parts = true; Quote = false. */
  allowReorder: boolean;
  /** When false, the card shows display-only rows even in edit mode
   *  (e.g. Quote on non-draft status). */
  allowEditExisting: boolean;

  // Empty-state copy.
  emptyStateLabel: string;
  emptyStateCtaLabel: string;

  // ── Translations ──
  /** Project a server line row into the canonical draft shape. */
  hydrateDraft: (line: TServerLine) => LineItemDraft;
  /** Build a synthetic ProductOption from a server line so the row
   *  chip renders without an extra catalog fetch. Returns null for
   *  manual lines (`productId === null`). */
  resolveProduct?: (line: TServerLine) => ProductOption | null;

  // ── Save ──
  /** Adapter-owned save executor. Receives the diff plan and decides:
   *    - Which canonical mutation maps to each diff slice.
   *    - Whether to use Promise.allSettled (Invoice), sequential
   *      (Job Parts), or atomic (templates).
   *    - Which fields to strip on PATCH (Invoice strips
   *      `lineItemType` + `source`; others may differ).
   *    - Description fallback (use `entry.uiSelectedProduct.name`).
   *  Resolves with success status + failure count for the toast layer.
   */
  saveAll: (plan: SavePlan) => Promise<SaveResult>;

  // ── Validation ──
  /** Return null if the entry is valid; else a string error message
   *  (used by the hook's "skipped rows" toast). */
  validateEntry?: (entry: LineDraftEntry) => string | null;

  // ── Carry-over on product change ──
  /** Optional override. The default rule (in the hook) preserves user
   *  overrides on existing rows and resets all fields on new rows.
   *  Job Parts overrides this to also preserve `isNew`. */
  applyProductCarryOver?: (
    current: LineItemDraft,
    original: LineItemDraft | null,
    newProduct: ProductOption,
  ) => Partial<LineItemDraft>;

  // ── Reorder ──
  /** Fired when the user drags a row to a new position. Adapter
   *  decides whether to fire the reorder mutation immediately or
   *  bundle it into Save. Invoice fires immediately; Job Parts on
   *  Save (handled inside `saveAll` plan.reorder). */
  onReorder?: (orderedServerIds: string[]) => void;

  // ── Create-product flow ──
  /** Opens the canonical AddProductModal. Resolves with the created
   *  (or matched-existing) ProductOption, or null if the user cancels.
   *  Adapter is responsible for the matched-vs-created toast UX. */
  requestCreateProduct?: (name: string) => Promise<ProductOption | null>;

  // ── Misc UX ──
  /** Toast handler — adapter owns the toast surface. Called for the
   *  "skipped rows" informational toast and for the empty-but-tried-to-
   *  save case. */
  onInformationalToast?: (title: string, description: string) => void;
}
