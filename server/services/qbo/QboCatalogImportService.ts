/**
 * QboCatalogImportService - Import catalog items from QBO into the local app
 *
 * Handles:
 * - Fetching all items from QBO (paginated)
 * - Matching to local items by SKU (case-insensitive) then Name (case-insensitive)
 * - 3 import modes: merge, overwrite, wipe
 * - Dry-run mode: preview what would happen without writing
 *
 * IMPORTANT:
 * - This is a READ-from-QBO operation (no writes to QBO)
 * - All local writes are tenant-scoped by companyId
 * - Only imports Service, NonInventory, and Inventory type items
 */

import { db } from "../../db";
import { items } from "@shared/schema";
import { eq, and, isNull, isNotNull, sql } from "drizzle-orm";
import { QboClient } from "./QboClient";
import type { QBOItemResponse, QBOItemQueryResponse } from "./QboItemService";
import { QboSyncLogger } from "./QboSyncLogger";

// ============================================================
// TYPES
// ============================================================

export type CatalogImportMode = "merge" | "overwrite" | "wipe";

export interface CatalogImportOptions {
  dryRun: boolean;
  mode: CatalogImportMode;
}

/** Action taken for each item during import */
export type CatalogImportAction = "CREATE" | "LINK" | "UPDATE" | "SKIP" | "WIPE" | "ERROR";

export interface CatalogImportItemSummary {
  name: string;
  sku: string | null;
  type: string;
  action: CatalogImportAction;
  qboItemId: string;
  error?: string;
}

export interface CatalogImportResult {
  success: boolean;
  dryRun: boolean;
  mode: CatalogImportMode;
  totals: {
    fetched: number;
    matched: number;
    created: number;
    updated: number;
    skipped: number;
    wiped: number;
    errors: number;
  };
  sample: CatalogImportItemSummary[];
  warnings: string[];
  error?: string;
}

// Valid QBO item types we import
const IMPORTABLE_TYPES = new Set(["Service", "NonInventory", "Inventory"]);

// ============================================================
// SERVICE
// ============================================================

export class QboCatalogImportService {
  private client: QboClient;
  private companyId: string;
  private logger: QboSyncLogger;

  constructor(client: QboClient, companyId: string, triggeredBy?: string) {
    this.client = client;
    this.companyId = companyId;
    this.logger = new QboSyncLogger(companyId, triggeredBy);
  }

  /**
   * Import catalog items from QBO into the local app.
   * - merge: link + fill missing fields only
   * - overwrite: replace local fields with QBO values
   * - wipe: soft-delete QBO-linked items, then import fresh
   */
  async importCatalog(options: CatalogImportOptions): Promise<CatalogImportResult> {
    const { dryRun, mode } = options;
    const startTime = Date.now();
    const warnings: string[] = [];

    const result: CatalogImportResult = {
      success: true,
      dryRun,
      mode,
      totals: { fetched: 0, matched: 0, created: 0, updated: 0, skipped: 0, wiped: 0, errors: 0 },
      sample: [],
      warnings,
    };

    // Step 1: Fetch all items from QBO
    let qboItems: QBOItemResponse[];
    try {
      qboItems = await this.fetchAllQboItems();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      result.success = false;
      result.error = `Failed to fetch items from QBO: ${errorMessage}`;
      await this.logger.log({ eventType: "CATALOG_IMPORT", result: "FAILURE", errorMessage: result.error, durationMs: Date.now() - startTime });
      return result;
    }

    // Filter to importable types only
    const importable = qboItems.filter(i => IMPORTABLE_TYPES.has(i.Type));
    if (importable.length < qboItems.length) {
      warnings.push(`Skipped ${qboItems.length - importable.length} items with unsupported types (e.g., Group, Bundle).`);
    }
    result.totals.fetched = importable.length;

    // Step 2: Wipe mode — soft-delete QBO-linked local items first
    if (mode === "wipe") {
      const wipedCount = dryRun
        ? await this.countLinkedItems()
        : await this.wipeLinkedItems();
      result.totals.wiped = wipedCount;
    }

    // Step 3: Load local items for matching (after wipe, so we see the clean state)
    const localItems = await this.loadLocalItems();
    const { bySku, byName } = this.buildMatchIndexes(localItems);

    // Step 4: Process each QBO item
    // Collect non-skip items first in sample, then fill with skips up to 25
    const nonSkipSamples: CatalogImportItemSummary[] = [];
    const skipSamples: CatalogImportItemSummary[] = [];

    for (const qboItem of importable) {
      const summary: CatalogImportItemSummary = {
        name: qboItem.Name,
        sku: qboItem.Sku || null,
        type: qboItem.Type,
        action: "CREATE",
        qboItemId: qboItem.Id,
      };

      try {
        // Match by SKU first, then by Name
        const match = this.findMatch(qboItem, bySku, byName);

        if (match) {
          result.totals.matched++;

          // Already linked to this exact QBO item with same syncToken — skip
          if (match.qboItemId === qboItem.Id && match.qboSyncToken === qboItem.SyncToken && mode !== "overwrite") {
            summary.action = "SKIP";
            result.totals.skipped++;
          } else if (mode === "merge") {
            // Merge: link + fill missing fields only
            if (!dryRun) {
              await this.mergeItem(match.id, qboItem);
            }
            summary.action = match.qboItemId === qboItem.Id ? "UPDATE" : "LINK";
            result.totals.updated++;
          } else {
            // Overwrite or wipe: replace local fields with QBO values
            if (!dryRun) {
              await this.overwriteItem(match.id, qboItem);
            }
            summary.action = "UPDATE";
            result.totals.updated++;
          }
        } else {
          // No match — create new local item
          if (!dryRun) {
            await this.createItem(qboItem);
          }
          summary.action = "CREATE";
          result.totals.created++;
        }
      } catch (err) {
        summary.action = "ERROR";
        summary.error = err instanceof Error ? err.message : String(err);
        result.totals.errors++;
      }

      // Collect samples: non-skip first, then skip, up to 25 total
      if (summary.action !== "SKIP") {
        if (nonSkipSamples.length < 25) nonSkipSamples.push(summary);
      } else {
        if (skipSamples.length < 25) skipSamples.push(summary);
      }
    }

    // Build final sample: non-skip first, then fill with skips up to 25
    result.sample = nonSkipSamples.slice(0, 25);
    const remaining = 25 - result.sample.length;
    if (remaining > 0) {
      result.sample.push(...skipSamples.slice(0, remaining));
    }

    await this.logger.log({
      eventType: "CATALOG_IMPORT",
      result: result.totals.errors > 0 ? "PARTIAL" : "SUCCESS",
      responsePayload: { dryRun, mode, totals: result.totals },
      durationMs: Date.now() - startTime,
    });

    return result;
  }

  // ============================================================
  // PRIVATE HELPERS
  // ============================================================

  /** Fetch all items from QBO using paginated queries */
  private async fetchAllQboItems(): Promise<QBOItemResponse[]> {
    const all: QBOItemResponse[] = [];
    const pageSize = 100;
    let startPosition = 1;
    let hasMore = true;

    while (hasMore) {
      const query = `SELECT * FROM Item STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}`;
      const response = await this.client.get<QBOItemQueryResponse>(`/query?query=${encodeURIComponent(query)}`);

      if (!response.success || !response.data) {
        throw new Error(response.error?.message || "Failed to query QBO items");
      }

      const raw = response.raw as Record<string, unknown>;
      const queryResponse = raw.QueryResponse as QBOItemQueryResponse["QueryResponse"] | undefined;
      const fetched = queryResponse?.Item || [];

      all.push(...fetched);

      if (fetched.length < pageSize) {
        hasMore = false;
      } else {
        startPosition += fetched.length;
      }
    }

    return all;
  }

  /** Load all active, non-deleted local items for this company */
  private async loadLocalItems() {
    return db
      .select()
      .from(items)
      .where(and(
        eq(items.companyId, this.companyId),
        isNull(items.deletedAt),
      ));
  }

  /** Build case-insensitive indexes for matching */
  private buildMatchIndexes(localItems: Array<typeof items.$inferSelect>) {
    const bySku = new Map<string, typeof items.$inferSelect>();
    const byName = new Map<string, typeof items.$inferSelect>();

    for (const item of localItems) {
      if (item.sku?.trim()) {
        bySku.set(item.sku.trim().toLowerCase(), item);
      }
      if (item.name?.trim()) {
        byName.set(item.name.trim().toLowerCase(), item);
      }
    }

    return { bySku, byName };
  }

  /** Match a QBO item to a local item: SKU first, then Name */
  private findMatch(
    qboItem: QBOItemResponse,
    bySku: Map<string, typeof items.$inferSelect>,
    byName: Map<string, typeof items.$inferSelect>,
  ): typeof items.$inferSelect | null {
    if (qboItem.Sku?.trim()) {
      const match = bySku.get(qboItem.Sku.trim().toLowerCase());
      if (match) return match;
    }
    if (qboItem.Name?.trim()) {
      const match = byName.get(qboItem.Name.trim().toLowerCase());
      if (match) return match;
    }
    return null;
  }

  /** Map QBO Type to local type */
  private mapQboTypeToLocal(qboType: string): string {
    return qboType === "Service" ? "service" : "product";
  }

  /** Merge mode: link + fill only null/empty local fields */
  private async mergeItem(localId: string, qboItem: QBOItemResponse): Promise<void> {
    const [existing] = await db
      .select()
      .from(items)
      .where(eq(items.id, localId))
      .limit(1);

    if (!existing) return;

    const now = new Date();
    const updates: Record<string, unknown> = {
      qboItemId: qboItem.Id,
      qboSyncToken: qboItem.SyncToken,
      qboSyncStatus: "SYNCED",
      qboSyncError: null,
      qboLastSyncedAt: now,
      updatedAt: now,
    };

    // Only fill missing fields — never overwrite existing values
    if (!existing.name && qboItem.Name) updates.name = qboItem.Name;
    if (!existing.sku && qboItem.Sku) updates.sku = qboItem.Sku;
    if (!existing.description && qboItem.Description) updates.description = qboItem.Description;
    if (!existing.unitPrice && qboItem.UnitPrice != null) updates.unitPrice = String(qboItem.UnitPrice);
    if (!existing.cost && qboItem.PurchaseCost != null) updates.cost = String(qboItem.PurchaseCost);
    if (existing.isTaxable === null && qboItem.Taxable != null) updates.isTaxable = qboItem.Taxable;

    await db.update(items).set(updates).where(eq(items.id, localId));
  }

  /** Overwrite mode: replace local fields with QBO values */
  private async overwriteItem(localId: string, qboItem: QBOItemResponse): Promise<void> {
    const now = new Date();
    await db.update(items).set({
      name: qboItem.Name,
      sku: qboItem.Sku || null,
      description: qboItem.Description || null,
      unitPrice: qboItem.UnitPrice != null ? String(qboItem.UnitPrice) : null,
      cost: qboItem.PurchaseCost != null ? String(qboItem.PurchaseCost) : null,
      isTaxable: qboItem.Taxable ?? null,
      isActive: qboItem.Active,
      type: this.mapQboTypeToLocal(qboItem.Type),
      qboItemId: qboItem.Id,
      qboSyncToken: qboItem.SyncToken,
      qboSyncStatus: "SYNCED",
      qboSyncError: null,
      qboLastSyncedAt: now,
      updatedAt: now,
    }).where(eq(items.id, localId));
  }

  /** Create a new local item from a QBO item */
  private async createItem(qboItem: QBOItemResponse): Promise<string> {
    const now = new Date();
    const [inserted] = await db
      .insert(items)
      .values({
        companyId: this.companyId,
        type: this.mapQboTypeToLocal(qboItem.Type),
        name: qboItem.Name,
        sku: qboItem.Sku || null,
        description: qboItem.Description || null,
        unitPrice: qboItem.UnitPrice != null ? String(qboItem.UnitPrice) : null,
        cost: qboItem.PurchaseCost != null ? String(qboItem.PurchaseCost) : null,
        isTaxable: qboItem.Taxable ?? true,
        isActive: qboItem.Active,
        qboItemId: qboItem.Id,
        qboSyncToken: qboItem.SyncToken,
        qboSyncStatus: "SYNCED",
        qboSyncError: null,
        qboLastSyncedAt: now,
      })
      .returning({ id: items.id });

    return inserted.id;
  }

  /** Count QBO-linked items (for dry-run wipe preview) */
  private async countLinkedItems(): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(items)
      .where(and(
        eq(items.companyId, this.companyId),
        isNotNull(items.qboItemId),
        isNull(items.deletedAt),
      ));
    return row?.count ?? 0;
  }

  /** Soft-delete all QBO-linked items for this company */
  private async wipeLinkedItems(): Promise<number> {
    const now = new Date();
    const result = await db
      .update(items)
      .set({ deletedAt: now, isActive: false, updatedAt: now })
      .where(and(
        eq(items.companyId, this.companyId),
        isNotNull(items.qboItemId),
        isNull(items.deletedAt),
      ))
      .returning({ id: items.id });

    return result.length;
  }
}
