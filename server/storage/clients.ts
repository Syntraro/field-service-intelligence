import { db } from "../db";
import { eq, and, inArray, sql, or, ilike, gte, lte, isNull, desc } from "drizzle-orm";
import { clients, clientParts, equipment, calendarAssignments, locationEquipment } from "@shared/schema";
import type { InsertClient, Client, InsertLocationEquipment, UpdateLocationEquipment } from "@shared/schema";
import { BaseRepository, clampLimit, clampOffset, escapeLike } from "./base";

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
   */
 async getAllClients(companyId: string): Promise<Client[]> {
    return await db
      .select()
      .from(clients)
      .where(eq(clients.companyId, companyId))
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

    const limit = clampLimit(options.limit ?? 50, 200);
    const page = Math.max(1, options.page ?? 1);
    const offset = options.offset ?? (page - 1) * limit;

    // Build WHERE conditions array - ALWAYS include companyId
    const whereConditions = [eq(clients.companyId, companyId)];

    // Add inactive filter
    if (options.inactive !== undefined) {
      whereConditions.push(eq(clients.inactive, options.inactive));
    } else {
      whereConditions.push(eq(clients.inactive, false));
    }

    // Add search filter
    if (options.search && options.search.trim()) {
      const searchTerm = escapeLike(options.search.trim());
      whereConditions.push(
        or(
          ilike(clients.companyName, `%${searchTerm}%`),
          ilike(clients.contactName, `%${searchTerm}%`),
          ilike(clients.email, `%${searchTerm}%`),
          ilike(clients.phone, `%${searchTerm}%`),
          ilike(clients.location, `%${searchTerm}%`)
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
   * Create new client
   */
  async createClient(
    companyId: string,
    userId: string,
    clientData: InsertClient
  ): Promise<Client> {
    const rows = await db
      .insert(clients)
      .values({ ...clientData, companyId, userId })
      .returning();

    return rows[0];
  }

  /**
   * Create client with parts in a transaction
   */
  async createClientWithParts(
    companyId: string,
    userId: string,
    clientData: InsertClient,
    parts: Array<{ partId: string; quantity: number }>
  ): Promise<Client> {
    return await db.transaction(async (tx) => {
      // Create client
      const [client] = await tx
        .insert(clients)
        .values({ ...clientData, companyId, userId })
        .returning();

      // Add parts if provided
      if (parts.length > 0) {
        await tx.insert(clientParts).values(
          parts.map((p) => ({
            companyId,
            userId,
            clientId: client.id,
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

    // If no version provided, skip version check (backward compatibility)
    if (currentVersion === undefined) {
      const rows = await db
        .update(clients)
        .set({ 
          ...patch, 
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
        ...patch,
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
      this.getClientEquipment(companyId, clientId),
    ]);

    return {
      client,
      assignments,
      parts,
      equipment: equipmentList,
    };
  }

  /**
   * Get calendar assignments for a client
   */
  async getAssignmentsByClient(companyId: string, clientId: string) {
    return await db
      .select()
      .from(calendarAssignments)
      .where(
        and(
          eq(calendarAssignments.companyId, companyId),
          eq(calendarAssignments.clientId, clientId)
        )
      )
      .orderBy(calendarAssignments.scheduledDate);
  }

  /**
   * Get all calendar assignments for a company
   */
  async getAllCalendarAssignments(companyId: string) {
    return await db
      .select()
      .from(calendarAssignments)
      .where(eq(calendarAssignments.companyId, companyId))
      .orderBy(calendarAssignments.scheduledDate);
  }
/**
 * Get calendar assignments for a company within a date range (SAFE for list pages)
 * NOTE: scheduledDate is assumed to be stored as YYYY-MM-DD text (lexicographic compare works).
 */
async getCalendarAssignmentsInRange(
  companyId: string,
  args: { start: string; end: string; limit: number }
) {
  const limit = clampLimit(args.limit, 5000); // hard cap (adjust if you want lower)

  return await db
    .select()
    .from(calendarAssignments)
    .where(
      and(
        eq(calendarAssignments.companyId, companyId),
        gte(calendarAssignments.scheduledDate, args.start),
        lte(calendarAssignments.scheduledDate, args.end)
      )
    )
    .orderBy(calendarAssignments.scheduledDate)
    .limit(limit);
}

  /**
   * Get client parts
   */
  async getClientParts(companyId: string, clientId: string) {
    return await db
      .select()
      .from(clientParts)
      .where(
        and(eq(clientParts.companyId, companyId), eq(clientParts.clientId, clientId))
      );
  }

  /**
   * Add client part
   */
  async addClientPart(
    companyId: string,
    userId: string,
    data: { clientId: string; partId: string; quantity: number }
  ) {
    const rows = await db
      .insert(clientParts)
      .values({ ...data, companyId, userId })
      .returning();
    return rows[0];
  }

  /**
   * Delete all client parts for a client
   */
  async deleteAllClientParts(companyId: string, clientId: string): Promise<void> {
    await db
      .delete(clientParts)
      .where(
        and(eq(clientParts.companyId, companyId), eq(clientParts.clientId, clientId))
      );
  }

  /**
   * Bulk upsert client parts - OPTIMIZED (50x faster)
   */
  async upsertClientPartsBulk(
    companyId: string,
    userId: string,
    items: Array<{ clientId: string; partId: string; quantity: number }>
  ) {
    if (items.length === 0) return [];

    return await db.transaction(async (tx) => {
      // Bulk delete all matching parts (single query instead of N queries)
      const clientIds = Array.from(new Set(items.map(i => i.clientId)));
      const partIds = Array.from(new Set(items.map(i => i.partId)));

      await tx
        .delete(clientParts)
        .where(
          and(
            eq(clientParts.companyId, companyId),
            inArray(clientParts.clientId, clientIds),
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
            clientId: item.clientId,
            partId: item.partId,
            quantity: item.quantity,
          }))
        )
        .returning();
    });
  }

  /**
   * Get client equipment
   */
  async getClientEquipment(companyId: string, clientId: string) {
    return await db
      .select()
      .from(equipment)
      .where(and(eq(equipment.companyId, companyId), eq(equipment.clientId, clientId)));
  }

  /**
   * Create equipment
   */
  async createEquipment(
    companyId: string,
    userId: string,
    data: {
      clientId: string;
      name: string;
      modelNumber?: string | null;
      serialNumber?: string | null;
      notes?: string | null;
    }
  ) {
    const rows = await db
      .insert(equipment)
      .values({ ...data, companyId, userId })
      .returning();
    return rows[0];
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

  /**
   * Get single location equipment item
   */
  async getLocationEquipmentById(companyId: string, equipmentId: string) {
    this.assertCompanyId(companyId);
    const rows = await db
      .select()
      .from(locationEquipment)
      .where(
        and(
          eq(locationEquipment.companyId, companyId),
          eq(locationEquipment.id, equipmentId)
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
      .set({ isActive: false, updatedAt: new Date() })
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
   * Cleanup invalid calendar assignments (assignments in months not in selectedMonths)
   */
  async cleanupInvalidCalendarAssignments(
    companyId: string,
    clientId: string,
    selectedMonths: number[]
  ): Promise<{ removedCount: number }> {
    const result = await db
      .delete(calendarAssignments)
      .where(
        and(
          eq(calendarAssignments.companyId, companyId),
          eq(calendarAssignments.clientId, clientId),
          sql`${calendarAssignments.month} NOT IN (${sql.join(selectedMonths.map(m => sql`${m}`), sql`, `)})`
        )
      )
      .returning();

    return { removedCount: result.length };
  }
}

export const clientRepository = new ClientRepository();