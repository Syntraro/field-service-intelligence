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
import type { Item } from "@shared/schema";
import { QboClient } from "./QboClient";
import type { QboTokens, QboApiResponse } from "./QboClient";
import { QboSyncLogger } from "./QboSyncLogger";

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

// ============================================================
// MAPPER FUNCTIONS
// ============================================================

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

function mapLocalItemToQBO(item: Item): Record<string, unknown> {
  // Map local item type to QBO type
  const qboType = item.type === "product" ? "NonInventory" : "Service";

  const payload: Record<string, unknown> = {
    Name: item.name || `Item ${item.id.substring(0, 8)}`,
    Type: qboType,
    Active: item.isActive ?? true,
  };

  // Add optional fields if present
  if (item.description) {
    payload.Description = item.description;
  }
  if (item.sku) {
    payload.Sku = item.sku;
  }
  if (item.unitPrice) {
    payload.UnitPrice = parseFloat(item.unitPrice);
  }
  if (item.cost) {
    payload.PurchaseCost = parseFloat(item.cost);
  }
  if (item.isTaxable !== null && item.isTaxable !== undefined) {
    payload.Taxable = item.isTaxable;
  }

  // For Service/NonInventory items, we need an IncomeAccountRef
  // This should ideally come from company configuration, but we'll use a placeholder
  // In production, this would be configured per-company
  payload.IncomeAccountRef = {
    value: "1", // Placeholder - should be configured per company
    name: "Services",
  };

  return payload;
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
      // Build QBO query
      let qboQuery = `SELECT * FROM Item WHERE Active = true`;
      if (query) {
        // Search by name (case-insensitive LIKE)
        qboQuery += ` AND Name LIKE '%${query.replace(/'/g, "''")}%'`;
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

      // Map to QBO payload
      const payload = mapLocalItemToQBO(localItem);

      // Create in QBO
      const response = await this.client.post<QBOItemResponse>("/item", payload);

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
        durationMs: Date.now() - startTime,
      });

      return {
        success: false,
        error: errorMessage,
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
