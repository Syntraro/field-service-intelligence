/**
 * pricebookUsageService — canonical façade for pricebook ranking.
 *
 * One place owns the public interface for "what does this tenant use
 * most?" across both individual items AND saved groups. Today the two
 * sides use different storage:
 *
 *   • Items: usage is INFERRED from the canonical line tables
 *     (invoice_lines, quote_lines, job_parts) via a UNION ALL
 *     COUNT-GROUP-BY in `ItemRepository.getItems(..., "most_used")`.
 *     We do NOT carry an `items.usage_count` column — keeping items
 *     authoritative-by-actual-use means a tenant can't game the
 *     ranking by visiting the picker, and there's no drift risk
 *     between a counter column and the line tables.
 *
 *   • Groups: usage is TRACKED EXPLICITLY via
 *     `pricebook_groups.usage_count`, incremented on every bulk-add.
 *     Groups don't appear on line items directly (they expand into
 *     children), so the line-table inference would always return 0.
 *
 * Why a service if items just delegates?
 * --------------------------------------
 * The directive is architectural: future ranking work (recency
 * weighting, favorites pinning, per-user vs per-tenant ranking,
 * analytics) plugs into ONE module. Routes and React components must
 * not own ranking logic directly. Today the service is a thin façade;
 * tomorrow it can grow without forcing edits across N callers.
 *
 * Existing items route (`GET /api/items?sort=most_used`) is
 * unchanged. The route still calls `ItemRepository.getItems` directly
 * — that path is exercised by `tests/pricebook-most-used-sort.test.ts`
 * and the test pins the SQL shape, so re-routing it through the
 * service would require updating that test surface for no behavior
 * change. Leaving the existing path in place + adding the service
 * façade means both work today; future migrations can route the route
 * through the service when the time is right.
 *
 * Public API
 * ----------
 *   getMostUsedItems(companyId, opts?)   → ranked Item rows
 *   getMostUsedGroups(companyId, opts?)  → ranked PricebookGroupSummary rows
 *   recordUsage(input)                   → increments per `kind`
 *
 * `recordUsage` is the single point through which any caller (route,
 * job/quote/invoice append handler) reports a usage event. For groups
 * it bumps the counter; for items it's a no-op TODAY (line-table
 * inference is the truth) — but having the signature in place means
 * future per-item recency tracking can ship without changing callers.
 */
import {
  ItemRepository,
  type ItemListSort,
} from "../storage/items";
import {
  pricebookGroupRepository,
  type PricebookGroupListSort,
  type PricebookGroupSummary,
} from "../storage/pricebookGroups";
import type { Item } from "@shared/schema";

const itemRepository = new ItemRepository();

/** Where the usage event happened. Free-form string so future surfaces
 *  (e.g., "estimate", "pm_template") plug in without a schema change. */
export type PricebookUsageTarget =
  | "job"
  | "quote"
  | "invoice"
  | "job_template"
  | "quote_template"
  | "pm_template";

export type PricebookUsageKind = "item" | "group";

export interface RecordPricebookUsageInput {
  companyId: string;
  /** What was added. */
  kind: PricebookUsageKind;
  /** ID of the item or group that was added. */
  id: string;
  /** Where it was added (job/quote/invoice/...). */
  target: PricebookUsageTarget;
  /** Optional ID of the target entity. Reserved for future per-target
   *  analytics — today it's recorded by callers but not consumed. */
  targetId?: string | null;
  /** Optional usage delta (defaults to 1). When a single bulk-add
   *  appends N copies of the same group, callers may bump by N. */
  delta?: number;
}

export interface GetMostUsedItemsOptions {
  /** Optional search filter; passed through to the repo. */
  query?: string;
  /** Override sort. Defaults to `most_used`. */
  sort?: ItemListSort;
}

export interface GetMostUsedGroupsOptions {
  /** Override sort. Defaults to `most_used`. */
  sort?: PricebookGroupListSort;
}

export const pricebookUsageService = {
  /**
   * Ranked items for a tenant. Today this is a thin delegate to
   * `ItemRepository.getItems(companyId, query, sort)`; the
   * underlying SQL is unchanged. The façade exists so future ranking
   * features (recency weight, favorites overlay, ML-driven order)
   * can plug in here without changing call sites.
   */
  async getMostUsedItems(
    companyId: string,
    opts: GetMostUsedItemsOptions = {},
  ): Promise<Item[]> {
    const sort = opts.sort ?? "most_used";
    return itemRepository.getItems(companyId, opts.query, sort);
  },

  /**
   * Ranked groups for a tenant. Delegates to
   * `pricebookGroupRepository.listForCompany`. Default sort is
   * `most_used` (usage_count DESC, name ASC). Unused groups sort to
   * the bottom alphabetical.
   */
  async getMostUsedGroups(
    companyId: string,
    opts: GetMostUsedGroupsOptions = {},
  ): Promise<PricebookGroupSummary[]> {
    const sort = opts.sort ?? "most_used";
    return pricebookGroupRepository.listForCompany(companyId, sort);
  },

  /**
   * Record a usage event. Single entry point for ranking inputs.
   *
   *   • kind = "group" → atomic increment of
   *     `pricebook_groups.usage_count` by `delta` (default 1).
   *   • kind = "item"  → no-op. Today item ranking is INFERRED from
   *     line tables (invoice_lines / quote_lines / job_parts), so
   *     recording the event a second time here would double-count.
   *     The signature is in place so future per-item recency tracking
   *     can ship without changing callers.
   *
   * Tenant scoping is enforced at the storage layer — a stale client
   * cannot bump another tenant's counts. Errors surface to the
   * caller; callers may swallow them since usage tracking is
   * advisory (a missing increment never blocks the bulk-add itself).
   */
  async recordUsage(input: RecordPricebookUsageInput): Promise<void> {
    if (!input.companyId) return;
    const delta = Math.max(1, Math.floor(input.delta ?? 1));
    if (input.kind === "group") {
      await pricebookGroupRepository.incrementUsage(
        input.companyId,
        input.id,
        delta,
      );
      return;
    }
    // kind === "item": intentionally no-op for now. See doc-block.
  },
};

/** Dependency-injection seam for tests. Pass a stub `record` to
 *  observe calls without hitting the database. */
export type PricebookUsageService = typeof pricebookUsageService;
