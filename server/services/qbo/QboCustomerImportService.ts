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
  /** User-provided conflict resolutions keyed by QBO Customer Id */
  resolutions?: Record<string, ImportResolution>;
}

export interface ImportedRecord {
  qboCustomerId: string;
  displayName: string;
  type: "parent" | "child";
  action: "create" | "update" | "restore" | "skip" | "conflict";
  localId?: string;
  parentQboId?: string | null;
}

/** Conflict detected when a QBO customer matches multiple local records */
export interface ImportConflict {
  kind: "catalog" | "customer";
  qbo: {
    id: string;
    name: string;
    sku?: string | null;
    type?: string | null;
    email?: string | null;
  };
  matchBasis: "SKU" | "NAME" | "EMAIL" | "QBO_ID";
  candidates: Array<{
    localId: string;
    name: string;
    sku?: string | null;
    email?: string | null;
    isActive?: boolean;
    lastActivityAt?: string | null;
    isLinked?: boolean;
    qboId?: string | null;
  }>;
  defaultAction: "SKIP";
  message: string;
}

/** User's chosen resolution for a conflict */
export interface ImportResolution {
  action: "MAP" | "CREATE" | "SKIP";
  localId?: string;
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
    skipped: number;
    wiped: number;
    conflicts: number;
  };
  conflicts: ImportConflict[];
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
    const { dryRun, limit, includeInactive = false, mode = "overwrite", resolutions } = options;
    const startTime = Date.now();
    const warnings: string[] = [];

    const result: CustomerImportResult = {
      success: true,
      dryRun,
      mode,
      totals: { fetched: 0, parents: 0, children: 0, inactiveSkipped: 0, skipped: 0, wiped: 0, conflicts: 0 },
      conflicts: [],
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

    // Step 3: Load existing local mappings for upsert detection (includes extra fields for conflict display)
    const existingCompanies = await db
      .select({
        id: customerCompanies.id,
        qboCustomerId: customerCompanies.qboCustomerId,
        deletedAt: customerCompanies.deletedAt,
        name: customerCompanies.name,
        email: customerCompanies.email,
        isActive: customerCompanies.isActive,
      })
      .from(customerCompanies)
      .where(eq(customerCompanies.companyId, this.companyId));

    const existingLocations = await db
      .select({
        id: clientLocations.id,
        qboCustomerId: clientLocations.qboCustomerId,
        deletedAt: clientLocations.deletedAt,
        companyName: clientLocations.companyName,
        location: clientLocations.location,
        email: clientLocations.email,
        inactive: clientLocations.inactive,
      })
      .from(clientLocations)
      .where(eq(clientLocations.companyId, this.companyId));

    const companyByQboId = new Map(
      existingCompanies.filter(c => c.qboCustomerId).map(c => [c.qboCustomerId!, c])
    );
    const locationByQboId = new Map(
      existingLocations.filter(l => l.qboCustomerId).map(l => [l.qboCustomerId!, l])
    );

    // Build name-based fallback indexes for unlinked records (used when qboCustomerId match fails)
    const companyByName = new Map<string, typeof existingCompanies>();
    for (const c of existingCompanies) {
      if (c.qboCustomerId || c.deletedAt) continue; // Only unlinked, non-deleted
      const key = c.name.trim().toLowerCase();
      const arr = companyByName.get(key);
      if (arr) arr.push(c);
      else companyByName.set(key, [c]);
    }

    const locationByName = new Map<string, typeof existingLocations>();
    for (const l of existingLocations) {
      if (l.qboCustomerId || l.deletedAt) continue; // Only unlinked, non-deleted
      const key = l.companyName.trim().toLowerCase();
      const arr = locationByName.get(key);
      if (arr) arr.push(l);
      else locationByName.set(key, [l]);
    }

    // Step 4: Process parents with name-based fallback matching + conflict detection
    const parentQboToLocalId = new Map<string, string>();

    // Preload existing parent ID map
    for (const existing of existingCompanies) {
      if (existing.qboCustomerId) {
        parentQboToLocalId.set(existing.qboCustomerId, existing.id);
      }
    }

    for (const parent of parents) {
      let existing = companyByQboId.get(parent.qboCustomerId);

      // Name-based fallback when no qboCustomerId match
      if (!existing) {
        const nameKey = (parent.companyName || parent.displayName).trim().toLowerCase();
        const nameCandidates = companyByName.get(nameKey);

        if (nameCandidates && nameCandidates.length > 1) {
          // CONFLICT: multiple unlinked local companies with the same name
          const conflict: ImportConflict = {
            kind: "customer",
            qbo: { id: parent.qboCustomerId, name: parent.displayName, email: parent.email || null },
            matchBasis: "NAME",
            candidates: nameCandidates.map(c => ({
              localId: c.id,
              name: c.name,
              email: c.email ?? null,
              isActive: c.isActive,
              isLinked: !!c.qboCustomerId,
              qboId: c.qboCustomerId ?? null,
            })),
            defaultAction: "SKIP",
            message: `QBO customer "${parent.displayName}" matches ${nameCandidates.length} local companies by name.`,
          };
          result.conflicts.push(conflict);

          const resolution = resolutions?.[parent.qboCustomerId];
          if (resolution?.action === "MAP" && resolution.localId) {
            const target = nameCandidates.find(c => c.id === resolution.localId);
            if (!target) {
              const record: ImportedRecord = {
                qboCustomerId: parent.qboCustomerId, displayName: parent.displayName, type: "parent", action: "skip",
              };
              warnings.push(`Resolution for "${parent.displayName}": localId not found among candidates`);
              result.totals.skipped++;
              if (result.sample.length < 10) result.sample.push(record);
              continue;
            }
            // H1 staleness: re-fetch target when actually writing to guard against changes since preview
            if (!dryRun) {
              const fresh = await this.fetchCompanyForResolution(target.id);
              if (!fresh || fresh.deletedAt || fresh.isActive === false) {
                const record: ImportedRecord = {
                  qboCustomerId: parent.qboCustomerId, displayName: parent.displayName, type: "parent", action: "skip",
                };
                warnings.push(`Resolution for "${parent.displayName}": selected local record is no longer eligible (deleted or inactive).`);
                result.totals.skipped++;
                if (result.sample.length < 10) result.sample.push(record);
                continue;
              }
              if (fresh.qboCustomerId && fresh.qboCustomerId !== parent.qboCustomerId) {
                const record: ImportedRecord = {
                  qboCustomerId: parent.qboCustomerId, displayName: parent.displayName, type: "parent", action: "skip",
                };
                warnings.push(`Resolution for "${parent.displayName}": local record now linked to QBO ${fresh.qboCustomerId}; cannot re-link.`);
                result.totals.skipped++;
                if (result.sample.length < 10) result.sample.push(record);
                continue;
              }
            }
            existing = target;
          } else if (resolution?.action === "CREATE") {
            // Fall through to create (existing stays undefined)
          } else {
            // No resolution or SKIP → skip
            const record: ImportedRecord = {
              qboCustomerId: parent.qboCustomerId, displayName: parent.displayName, type: "parent", action: "conflict",
            };
            result.totals.conflicts++;
            if (result.sample.length < 10) result.sample.push(record);
            continue;
          }
        } else if (nameCandidates?.length === 1) {
          // Single name match — use as fallback
          existing = nameCandidates[0];
        }
      }

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
        const localId = await this.upsertCustomerCompany(parent, existing ? { id: existing.id, deletedAt: existing.deletedAt } : undefined, mode);
        record.localId = localId;
        parentQboToLocalId.set(parent.qboCustomerId, localId);

        if (record.action === "create") result.created.customerCompanies++;
        else if (record.action === "restore") result.restored.customerCompanies++;
        else result.updated.customerCompanies++;

        // Ensure parent has at least one primary location so it appears on Clients page
        const locationCreated = await this.ensurePrimaryLocation(localId, parent, false);
        if (locationCreated) result.created.clientLocations++;
      } else {
        // Dry-run: count whether a primary location would be created
        const checkId = existing?.id;
        if (checkId) {
          const wouldCreate = await this.ensurePrimaryLocation(checkId, parent, true);
          if (wouldCreate) result.wouldCreate.clientLocations++;
        } else {
          // New company → will definitely need a primary location
          result.wouldCreate.clientLocations++;
        }
      }

      if (result.sample.length < 10) {
        result.sample.push(record);
      }
    }

    // Step 5: Process children with name-based fallback matching + conflict detection
    for (const child of children) {
      let existing = locationByQboId.get(child.qboCustomerId);

      // Name-based fallback when no qboCustomerId match
      if (!existing) {
        const nameKey = (child.companyName || child.displayName).trim().toLowerCase();
        const nameCandidates = locationByName.get(nameKey);

        if (nameCandidates && nameCandidates.length > 1) {
          // CONFLICT: multiple unlinked local locations with the same name
          const conflict: ImportConflict = {
            kind: "customer",
            qbo: { id: child.qboCustomerId, name: child.displayName, email: child.email || null },
            matchBasis: "NAME",
            candidates: nameCandidates.map(l => ({
              localId: l.id,
              name: l.companyName,
              email: l.email ?? null,
              isActive: !l.inactive,
              isLinked: !!l.qboCustomerId,
              qboId: l.qboCustomerId ?? null,
            })),
            defaultAction: "SKIP",
            message: `QBO sub-customer "${child.displayName}" matches ${nameCandidates.length} local locations by name.`,
          };
          result.conflicts.push(conflict);

          const resolution = resolutions?.[child.qboCustomerId];
          if (resolution?.action === "MAP" && resolution.localId) {
            const target = nameCandidates.find(l => l.id === resolution.localId);
            if (!target) {
              const record: ImportedRecord = {
                qboCustomerId: child.qboCustomerId, displayName: child.displayName, type: "child", action: "skip", parentQboId: child.parentQboId,
              };
              warnings.push(`Resolution for "${child.displayName}": localId not found among candidates`);
              result.totals.skipped++;
              if (result.sample.length < 10) result.sample.push(record);
              continue;
            }
            // H1 staleness: re-fetch target when actually writing
            if (!dryRun) {
              const fresh = await this.fetchLocationForResolution(target.id);
              if (!fresh || fresh.deletedAt || fresh.inactive === true) {
                const record: ImportedRecord = {
                  qboCustomerId: child.qboCustomerId, displayName: child.displayName, type: "child", action: "skip", parentQboId: child.parentQboId,
                };
                warnings.push(`Resolution for "${child.displayName}": selected local record is no longer eligible (deleted or inactive).`);
                result.totals.skipped++;
                if (result.sample.length < 10) result.sample.push(record);
                continue;
              }
              if (fresh.qboCustomerId && fresh.qboCustomerId !== child.qboCustomerId) {
                const record: ImportedRecord = {
                  qboCustomerId: child.qboCustomerId, displayName: child.displayName, type: "child", action: "skip", parentQboId: child.parentQboId,
                };
                warnings.push(`Resolution for "${child.displayName}": local record now linked to QBO ${fresh.qboCustomerId}; cannot re-link.`);
                result.totals.skipped++;
                if (result.sample.length < 10) result.sample.push(record);
                continue;
              }
            }
            existing = target;
          } else if (resolution?.action === "CREATE") {
            // Fall through to create (existing stays undefined)
          } else {
            // No resolution or SKIP → skip
            const record: ImportedRecord = {
              qboCustomerId: child.qboCustomerId, displayName: child.displayName, type: "child", action: "conflict", parentQboId: child.parentQboId,
            };
            result.totals.conflicts++;
            if (result.sample.length < 10) result.sample.push(record);
            continue;
          }
        } else if (nameCandidates?.length === 1) {
          // Single name match — use as fallback
          existing = nameCandidates[0];
        }
      }

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

        const localId = await this.upsertClientLocation(child, existing ? { id: existing.id, deletedAt: existing.deletedAt } : undefined, parentLocalId || null, mode);
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

      // QboClient.processResponse extracts the entity key (QueryResponse) from QBO's
      // response wrapper, so response.data IS the QueryResponse content directly.
      const queryData = response.data as unknown as { Customer?: QBOCustomerResponse[] };
      const customers = queryData?.Customer || [];

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

  /**
   * H1 staleness guard: re-fetch a customer_company by ID to verify eligibility for MAP resolution.
   */
  private async fetchCompanyForResolution(localId: string) {
    const [row] = await db
      .select({ id: customerCompanies.id, qboCustomerId: customerCompanies.qboCustomerId, isActive: customerCompanies.isActive, deletedAt: customerCompanies.deletedAt })
      .from(customerCompanies)
      .where(and(eq(customerCompanies.id, localId), eq(customerCompanies.companyId, this.companyId)))
      .limit(1);
    return row ?? null;
  }

  /**
   * H1 staleness guard: re-fetch a client_location by ID to verify eligibility for MAP resolution.
   */
  private async fetchLocationForResolution(localId: string) {
    const [row] = await db
      .select({ id: clientLocations.id, qboCustomerId: clientLocations.qboCustomerId, inactive: clientLocations.inactive, deletedAt: clientLocations.deletedAt })
      .from(clientLocations)
      .where(and(eq(clientLocations.id, localId), eq(clientLocations.companyId, this.companyId)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Ensure a parent customer_company has at least one primary client_location.
   * Without this, parent companies with no QBO sub-customers are invisible on
   * the Clients page (which queries client_locations only).
   * Returns true if a new location was created (for counting).
   */
  private async ensurePrimaryLocation(
    parentLocalId: string,
    parsed: ParsedQBOCustomer,
    dryRun: boolean
  ): Promise<boolean> {
    const [existing] = await db
      .select({ id: clientLocations.id })
      .from(clientLocations)
      .where(and(
        eq(clientLocations.parentCompanyId, parentLocalId),
        eq(clientLocations.companyId, this.companyId),
        isNull(clientLocations.deletedAt),
      ))
      .limit(1);

    if (existing) return false; // Already has a location

    if (!dryRun) {
      const addr = parsed.shipAddress.street ? parsed.shipAddress : parsed.address;
      await db.insert(clientLocations).values({
        companyId: this.companyId,
        parentCompanyId: parentLocalId,
        companyName: parsed.companyName || parsed.displayName,
        location: "Main",
        address: addr.street,
        city: addr.city,
        province: addr.province,
        postalCode: addr.postalCode,
        email: parsed.email,
        phone: parsed.phone,
        inactive: !parsed.isActive,
        isPrimary: true,
        selectedMonths: [],
      });
    }
    return true;
  }
}
