/**
 * QboItemService - Item sync service for QBO integration
 *
 * Handles:
 * - Listing items from QBO (paged, with search)
 * - Creating items in QBO from local items
 * - Linking local items to existing QBO items
 *
 * RULES:
 * - All syncs must be explicitly triggered (no auto-sync)
 * - All operations logged to qbo_sync_events
 * - Enforces companyId isolation
 */

import { db } from "../../db";
import { items } from "@shared/schema";
import { eq, and, isNull, sql } from "drizzle-orm";
import type { Item, QboMappingConfig } from "@shared/schema";
import { companies } from "@shared/schema";
import { parseQboMappingConfig } from "./QboItemMapper";
import { QboClient } from "./QboClient";
import type { QboTokens, QboApiResponse } from "./QboClient";
import { QboSyncLogger } from "./QboSyncLogger";
import * as fs from "fs";

// ============================================================
// TYPES
// ============================================================

export interface QBOItemResponse {
  Id: string;
  Name: string;
  Description?: string;
  Type: string; // "Inventory", "Service", "NonInventory"
  Active: boolean;
  UnitPrice?: number;
  PurchaseCost?: number;
  Taxable?: boolean;
  Sku?: string;
  SyncToken: string;
}

export interface QBOItemQueryResponse {
  QueryResponse: {
    Item?: QBOItemResponse[];
    startPosition?: number;
    maxResults?: number;
    totalCount?: number;
  };
}

export interface ParsedQBOItem {
  id: string;
  name: string;
  description?: string;
  type: string;
  active: boolean;
  unitPrice?: number;
  purchaseCost?: number;
  taxable?: boolean;
  sku?: string;
  syncToken: string;
}

export interface ItemListResult {
  success: boolean;
  items: ParsedQBOItem[];
  totalCount?: number;
  error?: string;
}

export interface ItemCreateResult {
  success: boolean;
  qboItemId?: string;
  syncToken?: string;
  error?: string;
  errorCode?: string;
}

export interface ItemLinkResult {
  success: boolean;
  error?: string;
}

/** Summary of a single item in a catalog sync run */
export interface CatalogSyncItemSummary {
  itemId: string;
  name: string;
  type: string;
  action: "create" | "update" | "skip" | "error";
  qboItemId?: string;
  error?: string;
}

/** Result of a catalog sync (dry-run or real) */
export interface CatalogSyncResult {
  success: boolean;
  dryRun: boolean;
  totals: { eligible: number; creates: number; updates: number; skipped: number; errors: number };
  sample: CatalogSyncItemSummary[];
  /** All items that failed (not capped by sample limit) */
  errors: CatalogSyncItemSummary[];
  error?: string;
}

// ============================================================
// MAPPER FUNCTIONS
// ============================================================

/**
 * Fields that are ONLY valid for QBO Inventory items.
 * Including these on Service or NonInventory items causes:
 * "Request has invalid or unsupported property"
 */
const INVENTORY_ONLY_FIELDS = [
  "TrackQtyOnHand",
  "QtyOnHand",
  "InvStartDate",
  "AssetAccountRef",
] as const;

/**
 * Strip undefined, null, and empty-string values from a payload.
 * Prevents QBO from rejecting fields with no meaningful value.
 */
function stripEmptyFields(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(payload).filter(
      ([, v]) => v !== undefined && v !== null && v !== ""
    )
  );
}

function parseQBOItem(item: QBOItemResponse): ParsedQBOItem {
  return {
    id: item.Id,
    name: item.Name,
    description: item.Description,
    type: item.Type,
    active: item.Active,
    unitPrice: item.UnitPrice,
    purchaseCost: item.PurchaseCost,
    taxable: item.Taxable,
    sku: item.Sku,
    syncToken: item.SyncToken,
  };
}

/**
 * Build a QBO Item payload from a local catalog item.
 * Uses mapping config to determine QBO Item.Type:
 *   - service items → serviceQboItemType (default "Service")
 *   - product items → productQboItemType (default "NonInventory")
 * For updates, include Id + SyncToken (required by QBO for optimistic locking).
 * Type cannot be changed after creation in QBO, so it's only set on create.
 *
 * NonInventory/Service items: only Name, Sku, Description,
 * UnitPrice, Type, Active, Taxable, IncomeAccountRef.
 * Inventory-only fields (TrackQtyOnHand, QtyOnHand, InvStartDate,
 * AssetAccountRef) are stripped to avoid QBO rejection.
 *
 * IncomeAccountRef is set from mappingConfig.defaultIncomeAccountId.
 * Throws if missing — callers must validate before calling.
 */
function mapLocalItemToQBO(item: Item, forUpdate: boolean = false, mappingConfig?: QboMappingConfig | null): Record<string, unknown> {
  // Resolve QBO Item.Type from mapping config, with sensible defaults
  const qboType = item.type === "product"
    ? (mappingConfig?.productQboItemType || "NonInventory")
    : (mappingConfig?.serviceQboItemType || "Service");

  const payload: Record<string, unknown> = {
    Name: item.name || `Item ${item.id.substring(0, 8)}`,
    Active: item.isActive ?? true,
  };

  // QBO requires Type on every write (create and update).
  // While Type is immutable after creation, omitting it on updates
  // causes "ItemType required in Minor Version requests".
  payload.Type = qboType;

  // For updates, QBO requires Id + SyncToken
  if (forUpdate && item.qboItemId && item.qboSyncToken) {
    payload.Id = item.qboItemId;
    payload.SyncToken = item.qboSyncToken;
  }

  if (item.description) {
    // QBO uses Description for purchase-side and SalesDescription for sales-side.
    // We only set Description (appears on both) — SalesDescription not sent
    // separately to avoid redundancy; QBO defaults it from Description.
    payload.Description = item.description;
  }
  if (item.sku) {
    payload.Sku = item.sku;
  }
  if (item.unitPrice) {
    const parsed = parseFloat(item.unitPrice);
    if (!isNaN(parsed)) {
      payload.UnitPrice = parsed;
    }
  }
  if (item.isTaxable !== null && item.isTaxable !== undefined) {
    payload.Taxable = item.isTaxable;
  }

  // IncomeAccountRef required for Service/NonInventory on both create and update.
  // Uses defaultIncomeAccountId from mapping config; throws if missing.
  if (qboType === "Service" || qboType === "NonInventory") {
    const incomeAccountId = mappingConfig?.defaultIncomeAccountId;
    if (!incomeAccountId) {
      throw new Error("MAPPING_MISSING_INCOME_ACCOUNT: Select a default income account in QBO Mapping Config.");
    }
    payload.IncomeAccountRef = { value: incomeAccountId };
  }

  // Strip inventory-only fields for NonInventory and Service items
  // These cause "Request has invalid or unsupported property" in QBO
  if (qboType === "NonInventory" || qboType === "Service") {
    for (const field of INVENTORY_ONLY_FIELDS) {
      delete payload[field];
    }
    // Also strip purchase-side fields not needed for NonInventory/Service
    delete payload.PurchaseCost;
    delete payload.ExpenseAccountRef;
  }

  // Strip any undefined/null/empty values to avoid QBO rejection
  return stripEmptyFields(payload);
}

// ============================================================
// SERVICE CLASS
// ============================================================

export class QboItemService {
  private client: QboClient;
  private companyId: string;
  private triggeredBy: string | undefined;
  private syncRunId: string | undefined;
  private logger: QboSyncLogger;

  constructor(client: QboClient, companyId: string, triggeredBy?: string, syncRunId?: string) {
    this.client = client;
    this.companyId = companyId;
    this.triggeredBy = triggeredBy;
    this.syncRunId = syncRunId;
    this.logger = new QboSyncLogger(companyId, triggeredBy, syncRunId);
  }

  /**
   * List items from QBO with optional search and pagination
   */
  async listQboItems(options: {
    query?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<ItemListResult> {
    const { query, limit = 50, offset = 0 } = options;
    const startTime = Date.now();

    try {
      // Build QBO query — no Active filter; let caller filter if needed
      let qboQuery = `SELECT * FROM Item`;
      if (query) {
        // Search by name (case-insensitive LIKE)
        qboQuery += ` WHERE Name LIKE '%${query.replace(/'/g, "''")}%'`;
      }
      qboQuery += ` STARTPOSITION ${offset + 1} MAXRESULTS ${limit}`;

      const response = await this.client.get<QBOItemQueryResponse>(`/query?query=${encodeURIComponent(qboQuery)}`);

      if (!response.success || !response.data) {
        await this.logger.log({
          eventType: "ITEM_READ",
          result: "FAILURE",
          errorMessage: response.error?.message || "Failed to query items",
          errorCode: response.error?.code,
          durationMs: Date.now() - startTime,
        });

        return {
          success: false,
          items: [],
          error: response.error?.message || "Failed to query items",
        };
      }

      // Parse raw response - handle both wrapped and unwrapped formats
      const raw = response.raw as Record<string, unknown>;
      const queryResponse = raw.QueryResponse as QBOItemQueryResponse["QueryResponse"] | undefined;
      const qboItems = queryResponse?.Item || [];

      const parsedItems = qboItems.map(parseQBOItem);

      await this.logger.log({
        eventType: "ITEM_READ",
        result: "SUCCESS",
        responsePayload: { count: parsedItems.length, query },
        durationMs: Date.now() - startTime,
      });

      return {
        success: true,
        items: parsedItems,
        totalCount: queryResponse?.totalCount,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      await this.logger.log({
        eventType: "ITEM_READ",
        result: "FAILURE",
        errorMessage,
        durationMs: Date.now() - startTime,
      });

      return {
        success: false,
        items: [],
        error: errorMessage,
      };
    }
  }

  /**
   * Create a QBO item from a local item
   */
  async createQboItemFromLocalItem(itemId: string): Promise<ItemCreateResult> {
    const startTime = Date.now();

    try {
      // Fetch local item with company isolation
      const [localItem] = await db
        .select()
        .from(items)
        .where(and(
          eq(items.id, itemId),
          eq(items.companyId, this.companyId),
          isNull(items.deletedAt)
        ))
        .limit(1);

      if (!localItem) {
        return { success: false, error: "Item not found" };
      }

      // Check if already synced
      if (localItem.qboItemId) {
        return {
          success: false,
          error: `Item already synced to QBO (${localItem.qboItemId})`
        };
      }

      // Fetch mapping config for IncomeAccountRef resolution
      const [company] = await db
        .select({ qboMappingConfig: companies.qboMappingConfig })
        .from(companies)
        .where(eq(companies.id, this.companyId))
        .limit(1);
      const mappingConfig = parseQboMappingConfig(company?.qboMappingConfig);

      // Map to QBO payload (throws if income account not configured)
      const payload = mapLocalItemToQBO(localItem, false, mappingConfig);

      // Temporary diagnostic: log exact payload sent to QBO (no tokens/secrets)
      // Temporary: write payload to file for debugging (console.log goes to attached terminal)
      fs.appendFileSync("/tmp/qbo_item_payloads.log", `\n[${new Date().toISOString()}] [QBO ITEM PAYLOAD]\n${JSON.stringify(payload, null, 2)}\n`);

      // Create in QBO
      const response = await this.client.post<QBOItemResponse>("/item?minorversion=75", payload);

      if (!response.success || !response.data) {
        // Update local item with error
        await db
          .update(items)
          .set({
            qboSyncStatus: "ERROR",
            qboSyncError: response.error?.message || "QBO sync failed",
            updatedAt: new Date(),
          })
          .where(eq(items.id, itemId));

        await this.logger.log({
          eventType: "ITEM_CREATE",
          result: "FAILURE",
          itemId,
          requestPayload: payload,
          responsePayload: response.raw,
          errorMessage: response.error?.message,
          errorCode: response.error?.code,
          durationMs: Date.now() - startTime,
        });

        return {
          success: false,
          error: response.error?.message || "Failed to create item in QBO",
          errorCode: response.error?.code,
        };
      }

      const qboItem = response.data;

      // Update local item with QBO references
      await db
        .update(items)
        .set({
          qboItemId: qboItem.Id,
          qboSyncToken: qboItem.SyncToken,
          qboSyncStatus: "SYNCED",
          qboSyncError: null,
          updatedAt: new Date(),
        })
        .where(eq(items.id, itemId));

      await this.logger.log({
        eventType: "ITEM_CREATE",
        result: "SUCCESS",
        itemId,
        qboEntityId: qboItem.Id,
        qboSyncToken: qboItem.SyncToken,
        requestPayload: payload,
        responsePayload: response.raw,
        durationMs: Date.now() - startTime,
      });

      return {
        success: true,
        qboItemId: qboItem.Id,
        syncToken: qboItem.SyncToken,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      // Extract error code from "CODE: message" pattern if present
      const errorCode = errorMessage.startsWith("MAPPING_MISSING_INCOME_ACCOUNT") ? "MAPPING_MISSING_INCOME_ACCOUNT" : undefined;

      // Update local item with error
      await db
        .update(items)
        .set({
          qboSyncStatus: "ERROR",
          qboSyncError: errorMessage,
          updatedAt: new Date(),
        })
        .where(eq(items.id, itemId));

      await this.logger.log({
        eventType: "ITEM_CREATE",
        result: "FAILURE",
        itemId,
        errorMessage,
        errorCode,
        durationMs: Date.now() - startTime,
      });

      return {
        success: false,
        error: errorMessage,
        errorCode,
      };
    }
  }

  /**
   * Link a local item to an existing QBO item (no QBO API call)
   */
  async linkLocalItemToQboItem(itemId: string, qboItemId: string): Promise<ItemLinkResult> {
    const startTime = Date.now();

    try {
      // Verify local item exists and belongs to company
      const [localItem] = await db
        .select()
        .from(items)
        .where(and(
          eq(items.id, itemId),
          eq(items.companyId, this.companyId),
          isNull(items.deletedAt)
        ))
        .limit(1);

      if (!localItem) {
        return { success: false, error: "Item not found" };
      }

      // Check if already linked to a different QBO item
      if (localItem.qboItemId && localItem.qboItemId !== qboItemId) {
        return {
          success: false,
          error: `Item already linked to different QBO item (${localItem.qboItemId})`
        };
      }

      // Update local item with QBO link
      await db
        .update(items)
        .set({
          qboItemId,
          qboSyncStatus: "SYNCED",
          qboSyncError: null,
          updatedAt: new Date(),
        })
        .where(eq(items.id, itemId));

      await this.logger.log({
        eventType: "ITEM_LINK",
        result: "SUCCESS",
        itemId,
        qboEntityId: qboItemId,
        durationMs: Date.now() - startTime,
      });

      return { success: true };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";

      await this.logger.log({
        eventType: "ITEM_LINK",
        result: "FAILURE",
        itemId,
        qboEntityId: qboItemId,
        errorMessage,
        durationMs: Date.now() - startTime,
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Get local items with their QBO sync status
   */
  async getLocalItemsWithSyncStatus(options: {
    syncStatus?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<Item[]> {
    const { syncStatus, limit = 50, offset = 0 } = options;

    const conditions = [
      eq(items.companyId, this.companyId),
      isNull(items.deletedAt),
    ];

    if (syncStatus) {
      conditions.push(eq(items.qboSyncStatus, syncStatus));
    }

    return db
      .select()
      .from(items)
      .where(and(...conditions))
      .orderBy(sql`${items.name} ASC NULLS LAST`)
      .limit(limit)
      .offset(offset);
  }

  /**
   * Catalog Sync — push local catalog items to QBO as Products & Services.
   * - dryRun=true: compute counts and sample without calling QBO API
   * - dryRun=false: create/update each item in QBO, persist Id+SyncToken+lastSyncedAt
   * Returns totals and a sample of the first 5 items for UI display.
   */
  async syncCatalog(dryRun: boolean): Promise<CatalogSyncResult> {
    const startTime = Date.now();
    const sample: CatalogSyncItemSummary[] = [];
    const errorItems: CatalogSyncItemSummary[] = [];
    const totals = { eligible: 0, creates: 0, updates: 0, skipped: 0, errors: 0 };

    try {
      // Fetch mapping config to resolve QBO Item.Type per catalog item type
      const [company] = await db
        .select({ qboMappingConfig: companies.qboMappingConfig })
        .from(companies)
        .where(eq(companies.id, this.companyId))
        .limit(1);
      const mappingConfig = parseQboMappingConfig(company?.qboMappingConfig);

      // Fail fast if income account not configured — every item would fail
      if (!mappingConfig?.defaultIncomeAccountId) {
        return {
          success: false,
          dryRun,
          totals,
          sample,
          errors: [],
          error: "MAPPING_MISSING_INCOME_ACCOUNT: Select a default income account in QBO Mapping Config.",
        };
      }

      // Fetch all active, non-deleted items for this company
      const localItems = await db
        .select()
        .from(items)
        .where(and(
          eq(items.companyId, this.companyId),
          isNull(items.deletedAt),
          eq(items.isActive, true),
        ))
        .orderBy(sql`${items.name} ASC NULLS LAST`);

      totals.eligible = localItems.length;

      if (localItems.length === 0) {
        return { success: true, dryRun, totals, sample, errors: [] };
      }

      for (const item of localItems) {
        const isUpdate = !!item.qboItemId;
        const action: CatalogSyncItemSummary["action"] = isUpdate ? "update" : "create";
        const summaryEntry: CatalogSyncItemSummary = {
          itemId: item.id,
          name: item.name || `Item ${item.id.substring(0, 8)}`,
          type: item.type || "service",
          action,
        };

        if (dryRun) {
          // Dry run — just tally, no QBO calls
          if (isUpdate) { totals.updates++; } else { totals.creates++; }
          if (sample.length < 5) sample.push(summaryEntry);
          continue;
        }

        // Real sync — call QBO API
        try {
          const payload = mapLocalItemToQBO(item, isUpdate, mappingConfig);

          // Temporary diagnostic: log exact payload sent to QBO (no tokens/secrets)
          // Temporary: write payload to file for debugging (console.log goes to attached terminal)
      fs.appendFileSync("/tmp/qbo_item_payloads.log", `\n[${new Date().toISOString()}] [QBO ITEM PAYLOAD]\n${JSON.stringify(payload, null, 2)}\n`);

          // For updates missing SyncToken, skip to avoid QBO rejection
          if (isUpdate && !item.qboSyncToken) {
            summaryEntry.action = "skip";
            summaryEntry.error = "Missing SyncToken for update";
            totals.skipped++;
            if (sample.length < 5) sample.push(summaryEntry);
            continue;
          }

          const response = await this.client.post<QBOItemResponse>("/item?minorversion=75", payload);

          if (!response.success || !response.data) {
            summaryEntry.action = "error";
            summaryEntry.error = response.error?.message || "QBO API error";
            totals.errors++;
            errorItems.push(summaryEntry);

            await db.update(items).set({
              qboSyncStatus: "ERROR",
              qboSyncError: summaryEntry.error,
              updatedAt: new Date(),
            }).where(eq(items.id, item.id));
          } else {
            const qboItem = response.data;
            summaryEntry.qboItemId = qboItem.Id;
            if (isUpdate) { totals.updates++; } else { totals.creates++; }

            // Persist QBO references back to local item
            await db.update(items).set({
              qboItemId: qboItem.Id,
              qboSyncToken: qboItem.SyncToken,
              qboSyncStatus: "SYNCED",
              qboSyncError: null,
              qboLastSyncedAt: new Date(),
              updatedAt: new Date(),
            }).where(eq(items.id, item.id));
          }

          if (sample.length < 5) sample.push(summaryEntry);
        } catch (itemErr) {
          summaryEntry.action = "error";
          summaryEntry.error = itemErr instanceof Error ? itemErr.message : "Unknown error";
          totals.errors++;
          errorItems.push(summaryEntry);

          await db.update(items).set({
            qboSyncStatus: "ERROR",
            qboSyncError: summaryEntry.error,
            updatedAt: new Date(),
          }).where(eq(items.id, item.id));

          if (sample.length < 5) sample.push(summaryEntry);
        }
      }

      await this.logger.log({
        eventType: "CATALOG_SYNC",
        result: totals.errors > 0 ? "PARTIAL" : "SUCCESS",
        responsePayload: { dryRun, totals },
        durationMs: Date.now() - startTime,
      });

      return { success: true, dryRun, totals, sample, errors: errorItems };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";

      await this.logger.log({
        eventType: "CATALOG_SYNC",
        result: "FAILURE",
        errorMessage,
        durationMs: Date.now() - startTime,
      });

      return { success: false, dryRun, totals, sample, errors: errorItems, error: errorMessage };
    }
  }
}

// ============================================================
// FACTORY FUNCTION
// ============================================================

export function createItemService(
  client: QboClient,
  companyId: string,
  triggeredBy?: string,
  syncRunId?: string
): QboItemService {
  return new QboItemService(client, companyId, triggeredBy, syncRunId);
}

/**
 * Create item service from tokens (convenience function)
 */
export function createItemServiceFromTokens(
  tokens: QboTokens,
  companyId: string,
  triggeredBy?: string,
  syncRunId?: string
): QboItemService | null {
  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  const environment = (process.env.QBO_ENVIRONMENT as "sandbox" | "production") || "sandbox";

  if (!clientId || !clientSecret) {
    return null;
  }

  const client = new QboClient({ clientId, clientSecret, environment }, tokens);
  return new QboItemService(client, companyId, triggeredBy, syncRunId);
}
