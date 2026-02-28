/**
 * QboCustomerImportService - Import customers from QBO into the app
 *
 * Handles:
 * - Fetching all customers from QBO (paginated)
 * - 2-pass import: parents first, then children
 * - Upsert logic: match by qboCustomerId, create or update
 * - Soft-delete restoration: if a local record was soft-deleted, restore it
 * - Dry-run mode: preview what would happen without writing
 * - 3 import modes: merge (fill missing only), overwrite (replace), wipe (delete + reimport)
 *
 * IMPORTANT:
 * - This is a READ-from-QBO operation (no writes to QBO)
 * - All local writes are tenant-scoped by companyId
 * - Deeper-than-2-level QBO hierarchies are flattened
 */

import { db } from "../../db";
import { customerCompanies, clientLocations } from "@shared/schema";
import { eq, and, isNull, isNotNull, sql } from "drizzle-orm";
import { QboClient } from "./QboClient";
import type { QBOQueryResponse } from "./QboReadService";
import { QboSyncLogger } from "./QboSyncLogger";
import {
  parseQBOCustomerResponse,
  type QBOCustomerResponse,
  type ParsedQBOCustomer,
} from "../../qbo/mappers";

// ============================================================
// TYPES
// ============================================================

export type CustomerImportMode = "merge" | "overwrite" | "wipe";

export interface CustomerImportOptions {
  dryRun: boolean;
  mode?: CustomerImportMode;
  limit?: number;
  includeInactive?: boolean;
}

export interface ImportedRecord {
  qboCustomerId: string;
  displayName: string;
  type: "parent" | "child";
  action: "create" | "update" | "restore" | "skip";
  localId?: string;
  parentQboId?: string | null;
}

export interface CustomerImportResult {
  success: boolean;
  dryRun: boolean;
  mode: CustomerImportMode;
  totals: {
    fetched: number;
    parents: number;
    children: number;
    inactiveSkipped: number;
    wiped: number;
  };
  wouldCreate: { customerCompanies: number; clientLocations: number };
  wouldUpdate: { customerCompanies: number; clientLocations: number };
  wouldRestore: { customerCompanies: number; clientLocations: number };
  created: { customerCompanies: number; clientLocations: number };
  updated: { customerCompanies: number; clientLocations: number };
  restored: { customerCompanies: number; clientLocations: number };
  sample: ImportedRecord[];
  warnings: string[];
  error?: string;
}

// ============================================================
// SERVICE
// ============================================================

export class QboCustomerImportService {
  private client: QboClient;
  private companyId: string;
  private logger: QboSyncLogger;

  constructor(client: QboClient, companyId: string, triggeredBy?: string) {
    this.client = client;
    this.companyId = companyId;
    this.logger = new QboSyncLogger(companyId, triggeredBy);
  }

  /**
   * Import customers from QBO into the app
   * Pass 1: fetch all QBO customers
   * Pass 2: upsert parents (no ParentRef)
   * Pass 3: upsert children (with ParentRef)
   */
  async importCustomers(options: CustomerImportOptions): Promise<CustomerImportResult> {
    const { dryRun, limit, includeInactive = false, mode = "overwrite" } = options;
    const startTime = Date.now();
    const warnings: string[] = [];

    const result: CustomerImportResult = {
      success: true,
      dryRun,
      mode,
      totals: { fetched: 0, parents: 0, children: 0, inactiveSkipped: 0, wiped: 0 },
      wouldCreate: { customerCompanies: 0, clientLocations: 0 },
      wouldUpdate: { customerCompanies: 0, clientLocations: 0 },
      wouldRestore: { customerCompanies: 0, clientLocations: 0 },
      created: { customerCompanies: 0, clientLocations: 0 },
      updated: { customerCompanies: 0, clientLocations: 0 },
      restored: { customerCompanies: 0, clientLocations: 0 },
      sample: [],
      warnings,
    };

    // Step 1: Fetch all customers from QBO (paginated)
    let allQboCustomers: QBOCustomerResponse[];
    try {
      allQboCustomers = await this.fetchAllCustomers(includeInactive, limit);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      result.success = false;
      result.error = `Failed to fetch customers from QBO: ${errorMessage}`;

      await this.logger.log({
        eventType: "CUSTOMER_IMPORT",
        result: "FAILURE",
        errorMessage: result.error,
        durationMs: Date.now() - startTime,
      });

      return result;
    }

    result.totals.fetched = allQboCustomers.length;

    // Step 2: Parse and classify
    const parsed = allQboCustomers.map(c => parseQBOCustomerResponse(c));

    // Skip inactive if not requested
    const active = includeInactive ? parsed : parsed.filter(c => {
      if (!c.isActive) {
        result.totals.inactiveSkipped++;
        return false;
      }
      return true;
    });

    // Build a lookup map for resolving parent chains
    const qboMap = new Map<string, ParsedQBOCustomer>();
    for (const c of active) {
      qboMap.set(c.qboCustomerId, c);
    }

    // Separate parents and children, flattening deep hierarchies
    const parents: ParsedQBOCustomer[] = [];
    const children: ParsedQBOCustomer[] = [];

    for (const c of active) {
      if (!c.parentQboId) {
        parents.push(c);
      } else {
        // Resolve topmost ancestor for flattening
        const ancestor = this.resolveTopAncestor(c, qboMap);
        if (ancestor && ancestor.qboCustomerId !== c.parentQboId) {
          // Deep hierarchy — flatten: set parent to topmost ancestor
          warnings.push(
            `Flattened "${c.displayName}" (QBO ${c.qboCustomerId}): parent changed from ${c.parentQboId} to ${ancestor.qboCustomerId}`
          );
          c.parentQboId = ancestor.qboCustomerId;
        }
        children.push(c);
      }
    }

    result.totals.parents = parents.length;
    result.totals.children = children.length;

    // Step 2b: Wipe mode — soft-delete all QBO-linked customer records first
    if (mode === "wipe") {
      if (dryRun) {
        // Count what would be wiped
        const [ccCount] = await db.select({ count: sql<number>`count(*)::int` }).from(customerCompanies)
          .where(and(eq(customerCompanies.companyId, this.companyId), isNotNull(customerCompanies.qboCustomerId), isNull(customerCompanies.deletedAt)));
        const [clCount] = await db.select({ count: sql<number>`count(*)::int` }).from(clientLocations)
          .where(and(eq(clientLocations.companyId, this.companyId), isNotNull(clientLocations.qboCustomerId), isNull(clientLocations.deletedAt)));
        result.totals.wiped = (ccCount?.count ?? 0) + (clCount?.count ?? 0);
      } else {
        const now = new Date();
        const wipedLocations = await db.update(clientLocations)
          .set({ deletedAt: now, inactive: true, updatedAt: now })
          .where(and(eq(clientLocations.companyId, this.companyId), isNotNull(clientLocations.qboCustomerId), isNull(clientLocations.deletedAt)))
          .returning({ id: clientLocations.id });
        const wipedCompanies = await db.update(customerCompanies)
          .set({ deletedAt: now, isActive: false, updatedAt: now })
          .where(and(eq(customerCompanies.companyId, this.companyId), isNotNull(customerCompanies.qboCustomerId), isNull(customerCompanies.deletedAt)))
          .returning({ id: customerCompanies.id });
        result.totals.wiped = wipedLocations.length + wipedCompanies.length;
      }
    }

    // Step 3: Load existing local mappings for upsert detection
    const existingCompanies = await db
      .select({ id: customerCompanies.id, qboCustomerId: customerCompanies.qboCustomerId, deletedAt: customerCompanies.deletedAt })
      .from(customerCompanies)
      .where(eq(customerCompanies.companyId, this.companyId));

    const existingLocations = await db
      .select({ id: clientLocations.id, qboCustomerId: clientLocations.qboCustomerId, deletedAt: clientLocations.deletedAt })
      .from(clientLocations)
      .where(eq(clientLocations.companyId, this.companyId));

    const companyByQboId = new Map(
      existingCompanies.filter(c => c.qboCustomerId).map(c => [c.qboCustomerId!, c])
    );
    const locationByQboId = new Map(
      existingLocations.filter(l => l.qboCustomerId).map(l => [l.qboCustomerId!, l])
    );

    // Step 4: Process parents
    // Track created parent QBO IDs → local IDs (for child linking)
    const parentQboToLocalId = new Map<string, string>();

    // Preload existing parent ID map
    for (const existing of existingCompanies) {
      if (existing.qboCustomerId) {
        parentQboToLocalId.set(existing.qboCustomerId, existing.id);
      }
    }

    for (const parent of parents) {
      const existing = companyByQboId.get(parent.qboCustomerId);
      const record: ImportedRecord = {
        qboCustomerId: parent.qboCustomerId,
        displayName: parent.displayName,
        type: "parent",
        action: existing ? (existing.deletedAt ? "restore" : "update") : "create",
        localId: existing?.id,
      };

      if (record.action === "create") {
        result.wouldCreate.customerCompanies++;
      } else if (record.action === "restore") {
        result.wouldRestore.customerCompanies++;
      } else {
        result.wouldUpdate.customerCompanies++;
      }

      if (!dryRun) {
        const localId = await this.upsertCustomerCompany(parent, existing, mode);
        record.localId = localId;
        parentQboToLocalId.set(parent.qboCustomerId, localId);

        if (record.action === "create") result.created.customerCompanies++;
        else if (record.action === "restore") result.restored.customerCompanies++;
        else result.updated.customerCompanies++;
      }

      if (result.sample.length < 10) {
        result.sample.push(record);
      }
    }

    // Step 5: Process children
    for (const child of children) {
      const existing = locationByQboId.get(child.qboCustomerId);
      const record: ImportedRecord = {
        qboCustomerId: child.qboCustomerId,
        displayName: child.displayName,
        type: "child",
        action: existing ? (existing.deletedAt ? "restore" : "update") : "create",
        localId: existing?.id,
        parentQboId: child.parentQboId,
      };

      if (record.action === "create") {
        result.wouldCreate.clientLocations++;
      } else if (record.action === "restore") {
        result.wouldRestore.clientLocations++;
      } else {
        result.wouldUpdate.clientLocations++;
      }

      if (!dryRun) {
        // Resolve parent local ID
        const parentLocalId = child.parentQboId ? parentQboToLocalId.get(child.parentQboId) : null;
        if (child.parentQboId && !parentLocalId) {
          warnings.push(
            `Child "${child.displayName}" (QBO ${child.qboCustomerId}): parent QBO ${child.parentQboId} not found locally. Importing without parent link.`
          );
        }

        const localId = await this.upsertClientLocation(child, existing, parentLocalId || null, mode);
        record.localId = localId;

        if (record.action === "create") result.created.clientLocations++;
        else if (record.action === "restore") result.restored.clientLocations++;
        else result.updated.clientLocations++;
      }

      if (result.sample.length < 10) {
        result.sample.push(record);
      }
    }

    const durationMs = Date.now() - startTime;

    await this.logger.log({
      eventType: "CUSTOMER_IMPORT",
      result: result.success ? "SUCCESS" : "FAILURE",
      responsePayload: {
        dryRun,
        mode,
        totals: result.totals,
        created: dryRun ? result.wouldCreate : result.created,
        updated: dryRun ? result.wouldUpdate : result.updated,
        restored: dryRun ? result.wouldRestore : result.restored,
        warningCount: warnings.length,
      },
      durationMs,
    });

    return result;
  }

  /**
   * Fetch all customers from QBO using paginated queries
   */
  private async fetchAllCustomers(includeInactive: boolean, limit?: number): Promise<QBOCustomerResponse[]> {
    const allCustomers: QBOCustomerResponse[] = [];
    const pageSize = 100; // QBO max is 1000, use 100 for safety
    let startPosition = 1;
    let hasMore = true;

    while (hasMore) {
      const activeClause = includeInactive ? "" : " WHERE Active = true";
      const maxResults = limit
        ? Math.min(pageSize, limit - allCustomers.length)
        : pageSize;

      const query = `SELECT * FROM Customer${activeClause} STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`;
      const response = await this.client.queryCustomers<QBOQueryResponse<QBOCustomerResponse>>(query);

      if (!response.success || !response.data) {
        throw new Error(response.error?.message || "Failed to query QBO customers");
      }

      const queryResponse = response.data as unknown as QBOQueryResponse<QBOCustomerResponse>;
      const customers = queryResponse.QueryResponse?.Customer || [];

      allCustomers.push(...customers);

      // Check if we should continue paging
      if (customers.length < maxResults) {
        hasMore = false;
      } else if (limit && allCustomers.length >= limit) {
        hasMore = false;
      } else {
        startPosition += customers.length;
      }
    }

    return allCustomers;
  }

  /**
   * Walk ParentRef chain to find the topmost ancestor
   * Used to flatten deep QBO hierarchies (>2 levels) to our 2-level model
   */
  private resolveTopAncestor(
    customer: ParsedQBOCustomer,
    allCustomers: Map<string, ParsedQBOCustomer>,
    visited = new Set<string>()
  ): ParsedQBOCustomer | null {
    if (!customer.parentQboId) return customer;

    // Cycle detection
    if (visited.has(customer.qboCustomerId)) return null;
    visited.add(customer.qboCustomerId);

    const parent = allCustomers.get(customer.parentQboId);
    if (!parent) return null; // Parent not in dataset, can't resolve

    if (!parent.parentQboId) return parent; // Parent is top-level

    // Recurse to find topmost ancestor
    return this.resolveTopAncestor(parent, allCustomers, visited);
  }

  /**
   * Upsert a CustomerCompany from a parsed QBO customer
   * Returns the local ID of the created/updated record
   */
  private async upsertCustomerCompany(
    parsed: ParsedQBOCustomer,
    existing: { id: string; deletedAt: Date | null } | undefined,
    mode: CustomerImportMode = "overwrite"
  ): Promise<string> {
    const now = new Date();
    // QBO link fields always set regardless of mode
    const qboFields = {
      qboCustomerId: parsed.qboCustomerId,
      qboSyncToken: parsed.qboSyncToken,
      qboLastSyncedAt: now,
      qboSyncStatus: "SYNCED" as const,
      qboSyncError: null,
      updatedAt: now,
    };

    const fullData = {
      name: parsed.companyName || parsed.displayName,
      legalName: parsed.companyName || null,
      phone: parsed.phone,
      email: parsed.email,
      billingStreet: parsed.address.street,
      billingCity: parsed.address.city,
      billingProvince: parsed.address.province,
      billingPostalCode: parsed.address.postalCode,
      billingCountry: parsed.address.country,
      isActive: parsed.isActive,
      ...qboFields,
    };

    if (existing && mode === "merge") {
      // Merge: only fill missing fields, never overwrite existing values
      const [current] = await db.select().from(customerCompanies)
        .where(eq(customerCompanies.id, existing.id)).limit(1);
      const mergeData: Record<string, unknown> = { ...qboFields, deletedAt: null };
      if (!current?.name && fullData.name) mergeData.name = fullData.name;
      if (!current?.phone && fullData.phone) mergeData.phone = fullData.phone;
      if (!current?.email && fullData.email) mergeData.email = fullData.email;
      if (!current?.billingStreet && fullData.billingStreet) mergeData.billingStreet = fullData.billingStreet;
      if (!current?.billingCity && fullData.billingCity) mergeData.billingCity = fullData.billingCity;
      if (!current?.billingProvince && fullData.billingProvince) mergeData.billingProvince = fullData.billingProvince;
      if (!current?.billingPostalCode && fullData.billingPostalCode) mergeData.billingPostalCode = fullData.billingPostalCode;
      if (!current?.billingCountry && fullData.billingCountry) mergeData.billingCountry = fullData.billingCountry;
      await db.update(customerCompanies).set(mergeData)
        .where(and(eq(customerCompanies.id, existing.id), eq(customerCompanies.companyId, this.companyId)));
      return existing.id;
    }

    if (existing) {
      // Overwrite or wipe: replace all fields
      await db.update(customerCompanies).set({ ...fullData, deletedAt: null })
        .where(and(eq(customerCompanies.id, existing.id), eq(customerCompanies.companyId, this.companyId)));
      return existing.id;
    }

    // Create new
    const [inserted] = await db
      .insert(customerCompanies)
      .values({ companyId: this.companyId, ...fullData })
      .returning({ id: customerCompanies.id });
    return inserted.id;
  }

  /**
   * Upsert a ClientLocation from a parsed QBO sub-customer
   * Returns the local ID of the created/updated record
   */
  private async upsertClientLocation(
    parsed: ParsedQBOCustomer,
    existing: { id: string; deletedAt: Date | null } | undefined,
    parentLocalId: string | null,
    mode: CustomerImportMode = "overwrite"
  ): Promise<string> {
    const now = new Date();
    const serviceAddr = (parsed.shipAddress.street || parsed.shipAddress.city)
      ? parsed.shipAddress : parsed.address;
    const companyName = parsed.companyName || parsed.parentName || parsed.displayName;
    const locationLabel = parsed.locationName || parsed.displayName;

    // QBO link fields always set regardless of mode
    const qboFields = {
      qboCustomerId: parsed.qboCustomerId,
      qboParentCustomerId: parsed.parentQboId,
      qboSyncToken: parsed.qboSyncToken,
      qboLastSyncedAt: now,
      updatedAt: now,
    };

    const fullData = {
      parentCompanyId: parentLocalId,
      companyName,
      location: locationLabel,
      address: serviceAddr.street,
      city: serviceAddr.city,
      province: serviceAddr.province,
      postalCode: serviceAddr.postalCode,
      contactName: null as string | null,
      email: parsed.email,
      phone: parsed.phone,
      inactive: !parsed.isActive,
      billWithParent: parsed.billWithParent,
      ...qboFields,
    };

    if (existing && mode === "merge") {
      // Merge: only fill missing fields, never overwrite existing values
      const [current] = await db.select().from(clientLocations)
        .where(eq(clientLocations.id, existing.id)).limit(1);
      const mergeData: Record<string, unknown> = { ...qboFields, deletedAt: null, parentCompanyId: parentLocalId };
      if (!current?.companyName && companyName) mergeData.companyName = companyName;
      if (!current?.location && locationLabel) mergeData.location = locationLabel;
      if (!current?.address && serviceAddr.street) mergeData.address = serviceAddr.street;
      if (!current?.city && serviceAddr.city) mergeData.city = serviceAddr.city;
      if (!current?.province && serviceAddr.province) mergeData.province = serviceAddr.province;
      if (!current?.postalCode && serviceAddr.postalCode) mergeData.postalCode = serviceAddr.postalCode;
      if (!current?.email && parsed.email) mergeData.email = parsed.email;
      if (!current?.phone && parsed.phone) mergeData.phone = parsed.phone;
      await db.update(clientLocations).set(mergeData)
        .where(and(eq(clientLocations.id, existing.id), eq(clientLocations.companyId, this.companyId)));
      return existing.id;
    }

    if (existing) {
      // Overwrite or wipe: replace all fields
      await db.update(clientLocations).set({ ...fullData, deletedAt: null })
        .where(and(eq(clientLocations.id, existing.id), eq(clientLocations.companyId, this.companyId)));
      return existing.id;
    }

    // Create new
    const [inserted] = await db
      .insert(clientLocations)
      .values({ companyId: this.companyId, selectedMonths: [], ...fullData })
      .returning({ id: clientLocations.id });
    return inserted.id;
  }
}
