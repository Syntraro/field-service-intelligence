import { db } from "../db";
import { eq, and, inArray, sql, or, ilike, gte, lte, isNull, isNotNull, desc } from "drizzle-orm";
import { clients, clientParts, customerCompanies, jobs, locationEquipment, items } from "@shared/schema";
import type { InsertClient, Client, InsertLocationEquipment, UpdateLocationEquipment } from "@shared/schema";
import { BaseRepository, clampLimit, clampOffset, escapeLike } from "./base";
import { activeJobFilter } from "./jobFilters";
import { maybeGeocode } from "../utils/geocode";

export interface PaginationOptions {
  limit?: number;
  offset?: number;
  page?: number;
  search?: string;
  sortBy?: 'companyName' | 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
  inactive?: boolean;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    page: number;
    totalPages: number;
    hasMore: boolean;
  };
}

export class ClientRepository extends BaseRepository {
  /**
   * Get all clients for a company
   * Returns only active, non-deleted clients
   */
  async getAllClients(companyId: string): Promise<Client[]> {
    return await db
      .select()
      .from(clients)
      .where(and(
        eq(clients.companyId, companyId),
        isNull(clients.deletedAt), // Soft delete: only show non-deleted records
        // Active filter: treat NULL as active (legacy data compatibility)
        or(eq(clients.inactive, false), isNull(clients.inactive))
      ))
      .orderBy(
        clients.companyName,              // Primary: company name
        sql`${clients.isPrimary} DESC`,   // Secondary: primary locations first
        clients.createdAt                 // Tertiary: creation order (deterministic tie-breaker)
      );
  }

  /**
   * Get paginated clients with search and filtering
   * SECURITY FIX: Properly combines all WHERE clauses with AND to maintain tenant isolation
   */
  async getPaginatedClients(
    companyId: string,
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<Client>> {
    this.assertCompanyId(companyId);

    // Fix: raised max from 200 to 500 to support client list fetching all locations
    const limit = clampLimit(options.limit ?? 50, 500);
    const page = Math.max(1, options.page ?? 1);
    const offset = options.offset ?? (page - 1) * limit;

    // Build WHERE conditions array - ALWAYS include companyId and soft delete filter
    const whereConditions = [
      eq(clients.companyId, companyId),
      isNull(clients.deletedAt), // Soft delete: only show non-deleted records
    ];

    // Add inactive filter (for active/inactive tabs)
    // IMPORTANT: NULL inactive values are treated as active (legacy data compatibility)
    // Fix: when inactive param is omitted (undefined), return ALL locations so the
    // frontend Clients page can group by company and derive active/inactive status
    // from child locations. Previously this defaulted to active-only, breaking the
    // Inactive tab which always showed 0 companies.
    if (options.inactive === true) {
      whereConditions.push(eq(clients.inactive, true));
    } else if (options.inactive === false) {
      whereConditions.push(
        or(eq(clients.inactive, false), isNull(clients.inactive))!
      );
    }
    // When options.inactive is undefined → no filter → return all (active + inactive)

    // Add search filter.
    // 2026-05-01 strict-search: parented locations match by parent
    // customer company name (via correlated subquery so the storage
    // layer's return shape is unchanged); standalone locations match
    // their own `companyName`. Stale denormalized values on parented
    // rows are NOT searchable. Contact/email/phone/location-label
    // matchers continue to work — those are location attributes, not
    // names.
    if (options.search && options.search.trim()) {
      const searchTerm = escapeLike(options.search.trim());
      const pattern = `%${searchTerm}%`;
      whereConditions.push(
        or(
          // Parented: parent customer company name (subquery — no join,
          // preserves Client[] return type; PK lookup, performance neutral).
          sql`(${clients.parentCompanyId} IS NOT NULL AND EXISTS (
            SELECT 1 FROM ${customerCompanies}
            WHERE ${customerCompanies.id} = ${clients.parentCompanyId}
              AND ${customerCompanies.name} ILIKE ${pattern}
          ))`,
          // Standalone: own column.
          sql`(${clients.parentCompanyId} IS NULL AND ${clients.companyName} ILIKE ${pattern})`,
          ilike(clients.contactName, pattern),
          ilike(clients.email, pattern),
          ilike(clients.phone, pattern),
          ilike(clients.location, pattern)
        )!
      );
    }

    // Build query with ALL conditions ANDed together
    let query = db
      .select()
      .from(clients)
      .where(and(...whereConditions))
      .$dynamic();

    // Get total count with same filters
    const countResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(clients)
      .where(and(...whereConditions));

    const total = countResult[0]?.count ?? 0;

    // Apply sorting
    const sortBy = options.sortBy ?? 'companyName';
    const sortOrder = options.sortOrder ?? 'asc';

    // Apply sorting with deterministic tie-breakers
    if (sortBy === 'companyName') {
      if (sortOrder === 'desc') {
        query = query.orderBy(
          sql`${clients.companyName} DESC`,
          sql`${clients.isPrimary} DESC`,  // Primary locations first
          clients.createdAt                 // Tie-breaker
        );
      } else {
        query = query.orderBy(
          clients.companyName,
          sql`${clients.isPrimary} DESC`,  // Primary locations first
          clients.createdAt                 // Tie-breaker
        );
      }
    } else if (sortBy === 'createdAt') {
      if (sortOrder === 'desc') {
        query = query.orderBy(
          sql`${clients.createdAt} DESC`,
          clients.companyName,             // Tie-breaker
          sql`${clients.isPrimary} DESC`   // Tie-breaker
        );
      } else {
        query = query.orderBy(
          clients.createdAt,
          clients.companyName,             // Tie-breaker
          sql`${clients.isPrimary} DESC`   // Tie-breaker
        );
      }
    } else if (sortBy === 'updatedAt') {
      if (sortOrder === 'desc') {
        query = query.orderBy(
          sql`${clients.updatedAt} DESC`,
          clients.companyName,             // Tie-breaker
          sql`${clients.isPrimary} DESC`   // Tie-breaker
        );
      } else {
        query = query.orderBy(
          clients.updatedAt,
          clients.companyName,             // Tie-breaker
          sql`${clients.isPrimary} DESC`   // Tie-breaker
        );
      }
    }
    const data = await query.limit(limit).offset(offset);
    const totalPages = Math.ceil(total / limit);

    return {
      data,
      pagination: {
        total,
        limit,
        offset,
        page,
        totalPages,
        hasMore: offset + limit < total,
      },
    };
  }
  /**
   * Get single client by ID
   */
  async getClient(companyId: string, clientId: string): Promise<Client | null> {
    const rows = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.companyId, companyId)))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Create new client (raw insert, no dedupe).
   *
   * Prefer `createOrGetLocation` for routes that may receive repeat
   * submissions (modal re-clicks, double form posts, etc.). This
   * raw-insert variant is kept for callers that have already performed
   * their own dedupe (e.g. CSV importer with address-composite key) or
   * intentionally need a duplicate (none today).
   */
  async createClient(
    companyId: string,
    userId: string,
    clientData: InsertClient
  ): Promise<Client> {
    // Auto-geocode if address present but no lat/lng
    const geocoded = await maybeGeocode(clientData);
    const rows = await db
      .insert(clients)
      .values({ ...geocoded, companyId, userId })
      .returning();

    return rows[0];
  }

  /**
   * Canonical create-or-get for client locations.
   *
   * 2026-04-19 (Customer Data Integrity pass): tenant-scoped,
   * case-insensitive dedupe. Two natural-key scopes — selected by the
   * payload shape, matching the real schema's child + orphan models:
   *
   *   - **Child location** (has `parentCompanyId`): match by
   *     `(companyId, parentCompanyId, lower(location))` when `location`
   *     is a non-empty trimmed string.
   *   - **Orphan location** (no `parentCompanyId`): match by
   *     `(companyId, lower(companyName))` when `companyName` is a
   *     non-empty trimmed string.
   *
   * When neither natural key has a meaningful value (e.g. quick-create
   * flows that defer naming), no dedupe is possible — the insert
   * proceeds. The matching partial unique indexes in
   * `2026_04_19_customer_data_unique_indexes.sql` mirror these
   * predicates exactly.
   *
   * Lookup is scoped to `inactive = false` so deactivated locations
   * don't shadow new creates. No `deleted_at` logic — soft-delete is
   * being phased out architecturally; existing soft-deleted rows
   * already carry `inactive = true` (set by the same code path), so
   * they're naturally excluded from both lookup and index.
   *
   * Returns `{location, created}` so callers can distinguish
   * insert-vs-match without a second lookup.
   */
  async createOrGetLocation(
    companyId: string,
    userId: string,
    clientData: InsertClient,
  ): Promise<{ location: Client; created: boolean }> {
    const parentId = clientData.parentCompanyId ?? null;

    if (parentId) {
      const locName = (clientData.location ?? "").trim();
      if (locName) {
        const [existing] = await db
          .select()
          .from(clients)
          .where(and(
            eq(clients.companyId, companyId),
            eq(clients.parentCompanyId, parentId),
            sql`lower(${clients.location}) = lower(${locName})`,
            eq(clients.inactive, false),
          ))
          .limit(1);
        if (existing) return { location: existing, created: false };
      }
    } else {
      const orphanName = (clientData.companyName ?? "").trim();
      if (orphanName) {
        const [existing] = await db
          .select()
          .from(clients)
          .where(and(
            eq(clients.companyId, companyId),
            isNull(clients.parentCompanyId),
            sql`lower(${clients.companyName}) = lower(${orphanName})`,
            eq(clients.inactive, false),
          ))
          .limit(1);
        if (existing) return { location: existing, created: false };
      }
    }

    const created = await this.createClient(companyId, userId, clientData);
    return { location: created, created: true };
  }

  /** Transaction variant of `createOrGetLocation`. Same dedupe scopes. */
  async createOrGetLocationTx(
    tx: any,
    companyId: string,
    userId: string,
    clientData: InsertClient,
  ): Promise<{ location: Client; created: boolean }> {
    const parentId = clientData.parentCompanyId ?? null;

    if (parentId) {
      const locName = (clientData.location ?? "").trim();
      if (locName) {
        const rows: Client[] = await tx
          .select()
          .from(clients)
          .where(and(
            eq(clients.companyId, companyId),
            eq(clients.parentCompanyId, parentId),
            sql`lower(${clients.location}) = lower(${locName})`,
            eq(clients.inactive, false),
          ))
          .limit(1);
        if (rows[0]) return { location: rows[0], created: false };
      }
    } else {
      const orphanName = (clientData.companyName ?? "").trim();
      if (orphanName) {
        const rows: Client[] = await tx
          .select()
          .from(clients)
          .where(and(
            eq(clients.companyId, companyId),
            isNull(clients.parentCompanyId),
            sql`lower(${clients.companyName}) = lower(${orphanName})`,
            eq(clients.inactive, false),
          ))
          .limit(1);
        if (rows[0]) return { location: rows[0], created: false };
      }
    }

    const geocoded = await maybeGeocode(clientData);
    const [row] = await tx
      .insert(clients)
      .values({ ...geocoded, companyId, userId })
      .returning();
    return { location: row, created: true };
  }

  /**
   * Bulk create clients (single INSERT with multiple values)
   * Returns array of created clients
   *
   * PHASE A.1 GUARD: Uses explicit allowlisted fields - no spread from input
   * This prevents mass assignment even if schema validation is bypassed
   */
  async bulkCreateClients(
    companyId: string,
    userId: string,
    clientDataArray: InsertClient[]
  ): Promise<Client[]> {
    if (clientDataArray.length === 0) return [];

    // 2026-03-31: Geocode each imported location before insert.
    // maybeGeocode skips if valid coordinates already present (and passes
    // Canada bounds guard for Canadian addresses).
    const geocodedArray = await Promise.all(
      clientDataArray.map(data => maybeGeocode(data as any))
    );

    // PHASE A.1: Explicit allowlist - only these fields can be set from input
    // Forbidden fields blocked: id, companyId, userId, createdAt, updatedAt, version,
    // qboCustomerId, qboParentCustomerId, qboSyncToken, qboLastSyncedAt, deletedAt
    const rows = await db
      .insert(clients)
      .values(geocodedArray.map(data => ({
        // System fields (from session/server)
        companyId,
        userId,
        // Allowed user-provided fields (explicit allowlist)
        parentCompanyId: data.parentCompanyId ?? null,
        // 2026-04-10: Normalize blank companyName to null so COALESCE fallback works
        companyName: data.companyName?.trim() || null,
        location: data.location ?? null,
        address: data.address ?? null,
        city: data.city ?? null,
        province: data.province ?? null,
        postalCode: data.postalCode ?? null,
        contactName: data.contactName ?? null,
        email: data.email ?? null,
        phone: data.phone ?? null,
        roofLadderCode: data.roofLadderCode ?? null,
        notes: data.notes ?? null,
        selectedMonths: data.selectedMonths ?? [],
        inactive: data.inactive ?? false,
        nextDue: data.nextDue ?? null,
        isPrimary: data.isPrimary ?? false,
        needsDetails: data.needsDetails ?? false,
        billWithParent: data.billWithParent ?? true,
        lat: data.lat ?? null,
        lng: data.lng ?? null,
        // QBO fields intentionally NOT copied from input - must be set via QBO sync
        // version, deletedAt, createdAt, updatedAt handled by DB defaults
      })))
      .returning();

    return rows;
  }

  /**
   * Create client with parts in a transaction.
   *
   * 2026-04-20: routes the location insert through `createOrGetLocationTx`
   * so the same canonical natural-key dedupe applies as the rest of the
   * creation surface. If the location already matched an existing row,
   * the parts are still appended to it (clientParts is a quantity-tracked
   * line-item table — intentional duplicates are allowed per earlier audit).
   * Uses locationId as the canonical reference for parts.
   */
  async createClientWithParts(
    companyId: string,
    userId: string,
    clientData: InsertClient,
    parts: Array<{ partId: string; quantity: number }>
  ): Promise<Client> {
    return await db.transaction(async (tx) => {
      const { location: client } = await this.createOrGetLocationTx(tx, companyId, userId, clientData);

      if (parts.length > 0) {
        await tx.insert(clientParts).values(
          parts.map((p) => ({
            companyId,
            userId,
            locationId: client.id, // locationId is the canonical reference
            partId: p.partId,
            quantity: p.quantity,
          }))
        );
      }

      return client;
    });
  }

  /**
   * Update client with optimistic locking
   * @param currentVersion - Current version from client (for optimistic locking)
   */
  async updateClient(
    companyId: string,
    clientId: string,
    currentVersion: number | undefined,
    patch: Partial<InsertClient>
  ): Promise<Client | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(clientId, "clientId");

    // 2026-04-10: Normalize blank companyName to null so COALESCE fallback works
    if ("companyName" in patch && typeof patch.companyName === "string") {
      patch.companyName = patch.companyName.trim() || null;
    }

    // Auto-geocode when address changes and no explicit lat/lng provided
    const addressChanged = patch.address !== undefined || patch.city !== undefined
      || patch.province !== undefined || patch.postalCode !== undefined;
    const geocodedPatch = addressChanged ? await maybeGeocode(patch as any) : patch;

    // If no version provided, skip version check (backward compatibility)
    if (currentVersion === undefined) {
      const rows = await db
        .update(clients)
        .set({
          ...geocodedPatch,
          version: sql`${clients.version} + 1`,
          updatedAt: new Date()
        })
        .where(and(eq(clients.id, clientId), eq(clients.companyId, companyId)))
        .returning();

      return rows[0] ?? null;
    }

    // With version check - optimistic locking
    const rows = await db
      .update(clients)
      .set({
        ...geocodedPatch,
        version: sql`${clients.version} + 1`, // Increment version
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(clients.id, clientId),
          eq(clients.companyId, companyId),
          eq(clients.version, currentVersion) // Check version matches!
        )
      )
      .returning();

    if (rows.length === 0) {
      // Either client doesn't exist OR version mismatch
      const existing = await this.getClient(companyId, clientId);
      if (!existing) {
        throw this.notFoundError("Client");
      }
      
      // Version mismatch
      throw new Error(
        `Client was modified by another user. Please reload and try again. ` +
        `(Expected version: ${currentVersion}, Actual version: ${existing.version})`
      );
    }

    return rows[0];
  }

 /**
   * Delete client (soft delete)
   * Sets inactive flag and deletedAt instead of removing from database
   * This preserves referential integrity and allows recovery
   */
  async deleteClient(companyId: string, clientId: string): Promise<boolean> {
    this.assertCompanyId(companyId);
    this.validateUUID(clientId, "clientId");

    const rows = await db
      .update(clients)
      .set({
        inactive: true,
        deletedAt: new Date(), // Soft delete timestamp
        updatedAt: new Date()
      })
      .where(and(eq(clients.id, clientId), eq(clients.companyId, companyId)))
      .returning();

    return rows.length > 0;
  }

  /**
   * Bulk delete clients (soft delete)
   * Sets inactive flag and deletedAt on multiple clients at once
   */
  async deleteClients(
    companyId: string,
    clientIds: string[]
  ): Promise<{ deletedIds: string[]; notFoundIds: string[] }> {
    if (clientIds.length === 0) {
      return { deletedIds: [], notFoundIds: [] };
    }

    this.assertCompanyId(companyId);

    const deleted = await db
      .update(clients)
      .set({
        inactive: true,
        deletedAt: new Date(), // Soft delete timestamp
        updatedAt: new Date()
      })
      .where(and(inArray(clients.id, clientIds), eq(clients.companyId, companyId)))
      .returning();

    const deletedIds = deleted.map((c) => c.id);
    const notFoundIds = clientIds.filter((id) => !deletedIds.includes(id));

    return { deletedIds, notFoundIds };
  }

  /**
   * Get client report (client + assignments + parts + equipment)
   */
  async getClientReport(companyId: string, clientId: string) {
    const client = await this.getClient(companyId, clientId);
    if (!client) return null;

    const [assignments, parts, equipmentList] = await Promise.all([
      this.getAssignmentsByClient(companyId, clientId),
      this.getClientParts(companyId, clientId),
      // Phase 6 D1: use canonical locationEquipment directly
      this.getLocationEquipment(companyId, clientId),
    ]);

    return {
      client,
      assignments,
      parts,
      equipment: equipmentList,
    };
  }

  /**
   * Get scheduled jobs for a location (replaces getAssignmentsByClient)
   * MODEL A: Scheduling is on jobs table
   */
  async getAssignmentsByClient(companyId: string, locationId: string) {
    return await db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.companyId, companyId),
          eq(jobs.locationId, locationId),
          activeJobFilter(),
          isNotNull(jobs.scheduledStart)
        )
      )
      .orderBy(jobs.scheduledStart);
  }

  /**
   * Get all scheduled jobs for a company (replaces getAllCalendarAssignments)
   * MODEL A: Scheduling is on jobs table
   */
  async getAllCalendarAssignments(companyId: string) {
    return await db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.companyId, companyId),
          activeJobFilter(),
          isNotNull(jobs.scheduledStart)
        )
      )
      .orderBy(jobs.scheduledStart);
  }

  /**
   * Get scheduled jobs for a company within a date range
   * MODEL A: Scheduling is on jobs table
   */
  async getCalendarAssignmentsInRange(
    companyId: string,
    args: { start: string; end: string; limit: number }
  ) {
    const limit = clampLimit(args.limit, 5000);

    return await db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.companyId, companyId),
          activeJobFilter(),
          isNotNull(jobs.scheduledStart),
          gte(jobs.scheduledStart, new Date(args.start)),
          lte(jobs.scheduledStart, new Date(args.end))
        )
      )
      .orderBy(jobs.scheduledStart)
      .limit(limit);
  }

  /**
   * Get location parts
   * Uses locationId as the canonical reference
   */
  async getClientParts(companyId: string, locationId: string) {
    return await db
      .select()
      .from(clientParts)
      .where(
        and(
          eq(clientParts.companyId, companyId),
          eq(clientParts.locationId, locationId)
        )
      );
  }

  /**
   * Add location part
   * Uses locationId as the canonical reference
   */
  async addClientPart(
    companyId: string,
    userId: string,
    data: { clientId: string; partId: string; quantity: number }
  ) {
    const rows = await db
      .insert(clientParts)
      .values({
        companyId,
        userId,
        locationId: data.clientId, // locationId is the canonical reference
        partId: data.partId,
        quantity: data.quantity,
      })
      .returning();
    return rows[0];
  }

  /**
   * Delete all parts for a location
   * Uses locationId as the canonical reference
   */
  async deleteAllClientParts(companyId: string, locationId: string): Promise<void> {
    await db
      .delete(clientParts)
      .where(
        and(
          eq(clientParts.companyId, companyId),
          eq(clientParts.locationId, locationId)
        )
      );
  }

  /**
   * Validate that all location IDs belong to this company.
   * Returns { valid, invalid } sets for IDOR prevention on bulk operations.
   */
  async validateLocationOwnership(companyId: string, locationIds: string[]): Promise<{ valid: Set<string>; invalid: string[] }> {
    this.assertCompanyId(companyId);
    if (locationIds.length === 0) return { valid: new Set(), invalid: [] };
    const rows = await db.select({ id: clients.id }).from(clients)
      .where(and(eq(clients.companyId, companyId), sql`${clients.id} = ANY(${locationIds})`));
    const valid = new Set(rows.map(r => r.id));
    const invalid = locationIds.filter(id => !valid.has(id));
    return { valid, invalid };
  }

  /**
   * Validate that all item/part IDs belong to this company.
   * Returns { valid, invalid } sets for IDOR prevention on bulk operations.
   */
  async validateItemOwnership(companyId: string, itemIds: string[]): Promise<{ valid: Set<string>; invalid: string[] }> {
    this.assertCompanyId(companyId);
    if (itemIds.length === 0) return { valid: new Set(), invalid: [] };
    const rows = await db.select({ id: items.id }).from(items)
      .where(and(eq(items.companyId, companyId), sql`${items.id} = ANY(${itemIds})`));
    const valid = new Set(rows.map(r => r.id));
    const invalid = itemIds.filter(id => !valid.has(id));
    return { valid, invalid };
  }

  /**
   * Bulk upsert location parts - OPTIMIZED (50x faster)
   * Uses locationId as the canonical reference
   */
  async upsertClientPartsBulk(
    companyId: string,
    userId: string,
    items: Array<{ clientId: string; partId: string; quantity: number }>
  ) {
    if (items.length === 0) return [];

    return await db.transaction(async (tx) => {
      // Bulk delete all matching parts (single query instead of N queries)
      const locationIds = Array.from(new Set(items.map(i => i.clientId)));
      const partIds = Array.from(new Set(items.map(i => i.partId)));

      await tx
        .delete(clientParts)
        .where(
          and(
            eq(clientParts.companyId, companyId),
            inArray(clientParts.locationId, locationIds),
            inArray(clientParts.partId, partIds)
          )
        );

      // Bulk insert (single query with multiple values)
      const validItems = items.filter(i => i.quantity > 0);
      if (validItems.length === 0) return [];

      return await tx
        .insert(clientParts)
        .values(
          validItems.map(item => ({
            companyId,
            userId,
            locationId: item.clientId, // locationId is the canonical reference
            partId: item.partId,
            quantity: item.quantity,
          }))
        )
        .returning();
    });
  }

  /**
   * Get location equipment list
   */
  async getLocationEquipment(companyId: string, locationId: string) {
    this.assertCompanyId(companyId);
    return await db
      .select()
      .from(locationEquipment)
      .where(
        and(
          eq(locationEquipment.companyId, companyId),
          eq(locationEquipment.locationId, locationId),
          eq(locationEquipment.isActive, true)
        )
      )
      .orderBy(desc(locationEquipment.createdAt));
  }

  /** Get archived (soft-deleted) location equipment — for restore UI only */
  async getArchivedLocationEquipment(companyId: string, locationId: string) {
    this.assertCompanyId(companyId);
    return await db
      .select()
      .from(locationEquipment)
      .where(
        and(
          eq(locationEquipment.companyId, companyId),
          eq(locationEquipment.locationId, locationId),
          eq(locationEquipment.isActive, false)
        )
      )
      .orderBy(desc(locationEquipment.updatedAt));
  }

  /** Restore soft-deleted equipment: set isActive=true, deletedAt=null */
  async restoreLocationEquipment(companyId: string, equipmentId: string) {
    this.assertCompanyId(companyId);
    const rows = await db
      .update(locationEquipment)
      .set({ isActive: true, deletedAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(locationEquipment.companyId, companyId),
          eq(locationEquipment.id, equipmentId),
          eq(locationEquipment.isActive, false),
        )
      )
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Get single location equipment item (includes soft-deleted, for read-only history lookups).
   * Use getLocationEquipmentById() for write operations that require isActive = true.
   */
  async getLocationEquipmentAny(companyId: string, equipmentId: string) {
    this.assertCompanyId(companyId);
    const rows = await db
      .select()
      .from(locationEquipment)
      .where(
        and(
          eq(locationEquipment.companyId, companyId),
          eq(locationEquipment.id, equipmentId),
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Get single active location equipment item (for write operations).
   */
  async getLocationEquipmentById(companyId: string, equipmentId: string) {
    this.assertCompanyId(companyId);
    const rows = await db
      .select()
      .from(locationEquipment)
      .where(
        and(
          eq(locationEquipment.companyId, companyId),
          eq(locationEquipment.id, equipmentId),
          eq(locationEquipment.isActive, true),
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Create location equipment
   */
  async createLocationEquipment(
    companyId: string,
    locationId: string,
    data: Omit<InsertLocationEquipment, "companyId" | "locationId">
  ) {
    this.assertCompanyId(companyId);
    const rows = await db
      .insert(locationEquipment)
      .values({ ...data, companyId, locationId })
      .returning();
    return rows[0];
  }

  /**
   * Update location equipment
   */
  async updateLocationEquipment(
    companyId: string,
    equipmentId: string,
    data: UpdateLocationEquipment
  ) {
    this.assertCompanyId(companyId);
    const rows = await db
      .update(locationEquipment)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(locationEquipment.companyId, companyId),
          eq(locationEquipment.id, equipmentId)
        )
      )
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Delete location equipment (soft delete)
   */
  async deleteLocationEquipment(companyId: string, equipmentId: string) {
    this.assertCompanyId(companyId);
    const rows = await db
      .update(locationEquipment)
      .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(locationEquipment.companyId, companyId),
          eq(locationEquipment.id, equipmentId)
        )
      )
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Cleanup scheduled jobs outside allowed PM months (unschedule them)
   * MODEL A: Operates on jobs table, clears scheduling fields instead of deleting
   */
  async cleanupInvalidCalendarAssignments(
    companyId: string,
    locationId: string,
    selectedMonths: number[]
  ): Promise<{ removedCount: number }> {
    if (selectedMonths.length === 0) {
      return { removedCount: 0 };
    }

    // Build month check: EXTRACT(MONTH FROM scheduled_start) NOT IN (selectedMonths)
    const monthList = selectedMonths.join(', ');
    const result = await db
      .update(jobs)
      .set({
        scheduledStart: null,
        scheduledEnd: null,
        isAllDay: false,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(jobs.companyId, companyId),
          eq(jobs.locationId, locationId),
          isNull(jobs.deletedAt),
          isNotNull(jobs.scheduledStart),
          sql`EXTRACT(MONTH FROM ${jobs.scheduledStart})::int NOT IN (${sql.raw(monthList)})`
        )
      )
      .returning();

    return { removedCount: result.length };
  }
}

export const clientRepository = new ClientRepository();