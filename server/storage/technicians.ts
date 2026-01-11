import { db } from "../db";
import { eq, and, isNull } from "drizzle-orm";
import { technicians } from "@shared/schema";
import { BaseRepository } from "./base";

/**
 * Technician repository - handles all technician-related database operations.
 * Ensures tenant isolation via companyId scoping.
 */
export class TechnicianRepository extends BaseRepository {
  /**
   * Create a new technician
   */
  async createTechnician(companyId: string, name: string, userId?: string) {
    this.assertCompanyId(companyId);

    const [technician] = await db
      .insert(technicians)
      .values({ companyId, name, userId })
      .returning();

    return technician;
  }

  /**
   * Get all technicians for a company
   */
  async getTechniciansByCompany(companyId: string) {
    this.assertCompanyId(companyId);

    return await db
      .select()
      .from(technicians)
      .where(eq(technicians.companyId, companyId));
  }

  /**
   * Get a single technician by ID
   */
  async getTechnician(companyId: string, technicianId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(technicianId, "technicianId");

    const [technician] = await db
      .select()
      .from(technicians)
      .where(
        and(
          eq(technicians.id, technicianId),
          eq(technicians.companyId, companyId)
        )
      );

    return technician ?? null;
  }

  /**
   * Update a technician
   */
  async updateTechnician(
    companyId: string,
    technicianId: string,
    data: { name?: string; userId?: string | null }
  ) {
    this.assertCompanyId(companyId);
    this.validateUUID(technicianId, "technicianId");

    const [updated] = await db
      .update(technicians)
      .set(data)
      .where(
        and(
          eq(technicians.id, technicianId),
          eq(technicians.companyId, companyId)
        )
      )
      .returning();

    return updated ?? null;
  }

  /**
   * Delete a technician
   */
  async deleteTechnician(companyId: string, technicianId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(technicianId, "technicianId");

    const [deleted] = await db
      .delete(technicians)
      .where(
        and(
          eq(technicians.id, technicianId),
          eq(technicians.companyId, companyId)
        )
      )
      .returning();

    return !!deleted;
  }
}

export const technicianRepository = new TechnicianRepository();
