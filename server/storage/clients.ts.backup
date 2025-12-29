import { db } from "../db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { clients, clientParts, equipment, calendarAssignments } from "@shared/schema";
import type { InsertClient, Client } from "@shared/schema";
import { BaseRepository } from "./base";

export class ClientRepository extends BaseRepository {
  /**
   * Get all clients for a company
   */
  async getAllClients(companyId: string): Promise<Client[]> {
    return await db
      .select()
      .from(clients)
      .where(eq(clients.companyId, companyId))
      .orderBy(clients.companyName);
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
   * Update client
   */
  async updateClient(
    companyId: string,
    clientId: string,
    patch: Partial<InsertClient>
  ): Promise<Client | null> {
    const rows = await db
      .update(clients)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(clients.id, clientId), eq(clients.companyId, companyId)))
      .returning();

    return rows[0] ?? null;
  }

  /**
   * Delete client
   */
  async deleteClient(companyId: string, clientId: string): Promise<boolean> {
    const result = await db
      .delete(clients)
      .where(and(eq(clients.id, clientId), eq(clients.companyId, companyId)))
      .returning();

    return result.length > 0;
  }

  /**
   * Bulk delete clients
   */
  async deleteClients(
    companyId: string,
    clientIds: string[]
  ): Promise<{ deletedIds: string[]; notFoundIds: string[] }> {
    if (clientIds.length === 0) {
      return { deletedIds: [], notFoundIds: [] };
    }

    const deleted = await db
      .delete(clients)
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
   * Bulk upsert client parts (used by frontend bulk endpoint)
   */
  async upsertClientPartsBulk(
    companyId: string,
    items: Array<{ clientId: string; partId: string; quantity: number }>
  ) {
    if (items.length === 0) return [];

    return await db.transaction(async (tx) => {
      const results = [];
      for (const item of items) {
        // Delete existing
        await tx
          .delete(clientParts)
          .where(
            and(
              eq(clientParts.companyId, companyId),
              eq(clientParts.clientId, item.clientId),
              eq(clientParts.partId, item.partId)
            )
          );

        // Insert new
        if (item.quantity > 0) {
          const [inserted] = await tx
            .insert(clientParts)
            .values({
              companyId,
              userId: companyId, // TODO: Pass actual userId
              clientId: item.clientId,
              partId: item.partId,
              quantity: item.quantity,
            })
            .returning();
          results.push(inserted);
        }
      }
      return results;
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