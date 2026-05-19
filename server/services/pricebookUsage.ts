/**
 * pricebookUsageService — canonical façade for pricebook ranking.
 *
 * Items: usage is INFERRED from the canonical line tables
 * (invoice_lines, quote_lines, job_parts) via a UNION ALL
 * COUNT-GROUP-BY in `ItemRepository.getItems(..., "most_used")`.
 * We do NOT carry an `items.usage_count` column — keeping items
 * authoritative-by-actual-use means a tenant can't game the
 * ranking by visiting the picker, and there's no drift risk
 * between a counter column and the line tables.
 *
 * Public API
 * ----------
 *   getMostUsedItems(companyId, opts?)   → ranked Item rows
 */
import {
  ItemRepository,
  type ItemListSort,
} from "../storage/items";
import type { Item } from "@shared/schema";

const itemRepository = new ItemRepository();

export interface GetMostUsedItemsOptions {
  query?: string;
  sort?: ItemListSort;
}

export const pricebookUsageService = {
  async getMostUsedItems(
    companyId: string,
    opts: GetMostUsedItemsOptions = {},
  ): Promise<Item[]> {
    const sort = opts.sort ?? "most_used";
    return itemRepository.getItems(companyId, opts.query, sort);
  },
};

export type PricebookUsageService = typeof pricebookUsageService;
