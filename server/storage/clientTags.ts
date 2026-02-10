/**
 * Client Tags Repository — Phase 1 Client Tags + Phase 1B Location Tags
 * Tenant-scoped tag management, customer-company tag assignments, and location tag assignments.
 */
import { db } from "../db";
import { and, eq, ilike, inArray } from "drizzle-orm";
import { clientTags, clientTagAssignments, locationTagAssignments, customerCompanies, clientLocations } from "@shared/schema";
import { BaseRepository } from "./base";

export class ClientTagRepository extends BaseRepository {
  /** Get all tags for a tenant */
  async getTagsByCompany(companyId: string) {
    this.assertCompanyId(companyId);
    return db
      .select()
      .from(clientTags)
      .where(eq(clientTags.companyId, companyId))
      .orderBy(clientTags.name);
  }

  /** Create a new tag (name must be unique per tenant) */
  async createTag(companyId: string, data: { name: string; color?: string }) {
    this.assertCompanyId(companyId);
    const name = data.name.trim();
    if (!name) throw this.validationError("Tag name is required");

    const [tag] = await db
      .insert(clientTags)
      .values({ companyId, name, color: data.color ?? "#6b7280" })
      .returning();
    return tag;
  }

  /** Update tag name/color */
  async updateTag(companyId: string, tagId: string, data: { name?: string; color?: string }) {
    const where = this.whereIdAndCompany(clientTags, tagId, companyId);
    const updates: Record<string, string> = {};
    if (data.name !== undefined) {
      const name = data.name.trim();
      if (!name) throw this.validationError("Tag name is required");
      updates.name = name;
    }
    if (data.color !== undefined) updates.color = data.color;

    if (!Object.keys(updates).length) throw this.validationError("No updates provided");

    const [tag] = await db.update(clientTags).set(updates).where(where!).returning();
    if (!tag) throw this.notFoundError("Tag");
    return tag;
  }

  /** Delete a tag (cascades to assignments) */
  async deleteTag(companyId: string, tagId: string) {
    const where = this.whereIdAndCompany(clientTags, tagId, companyId);
    const [deleted] = await db.delete(clientTags).where(where!).returning();
    if (!deleted) throw this.notFoundError("Tag");
    return deleted;
  }

  /** Get all tags assigned to a specific customer company */
  async getTagsForCustomerCompany(companyId: string, customerCompanyId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(customerCompanyId, "customerCompanyId");
    return db
      .select({ tag: clientTags })
      .from(clientTagAssignments)
      .innerJoin(clientTags, eq(clientTagAssignments.tagId, clientTags.id))
      .where(
        and(
          eq(clientTagAssignments.companyId, companyId),
          eq(clientTagAssignments.customerCompanyId, customerCompanyId),
        )
      )
      .orderBy(clientTags.name)
      .then((rows) => rows.map((r) => r.tag));
  }

  /** Bulk assign/remove tags for a customer company */
  async updateCustomerCompanyTags(
    companyId: string,
    customerCompanyId: string,
    addTagIds: string[],
    removeTagIds: string[],
  ) {
    this.assertCompanyId(companyId);
    this.validateUUID(customerCompanyId, "customerCompanyId");

    // Verify customer company belongs to tenant
    const [cc] = await db
      .select({ id: customerCompanies.id })
      .from(customerCompanies)
      .where(and(eq(customerCompanies.id, customerCompanyId), eq(customerCompanies.companyId, companyId)))
      .limit(1);
    if (!cc) throw this.notFoundError("Customer company");

    return this.tx(async (txDb) => {
      // Remove tags
      if (removeTagIds.length > 0) {
        await txDb
          .delete(clientTagAssignments)
          .where(
            and(
              eq(clientTagAssignments.companyId, companyId),
              eq(clientTagAssignments.customerCompanyId, customerCompanyId),
              inArray(clientTagAssignments.tagId, removeTagIds),
            )
          );
      }

      // Add tags (ON CONFLICT ignore for idempotency)
      if (addTagIds.length > 0) {
        // Verify all tags belong to this tenant
        const validTags = await txDb
          .select({ id: clientTags.id })
          .from(clientTags)
          .where(and(eq(clientTags.companyId, companyId), inArray(clientTags.id, addTagIds)));
        const validIds = new Set(validTags.map((t) => t.id));

        const rows = addTagIds
          .filter((id) => validIds.has(id))
          .map((tagId) => ({ companyId, tagId, customerCompanyId }));

        if (rows.length > 0) {
          await txDb
            .insert(clientTagAssignments)
            .values(rows)
            .onConflictDoNothing();
        }
      }

      // Return updated tag list
      return txDb
        .select({ tag: clientTags })
        .from(clientTagAssignments)
        .innerJoin(clientTags, eq(clientTagAssignments.tagId, clientTags.id))
        .where(
          and(
            eq(clientTagAssignments.companyId, companyId),
            eq(clientTagAssignments.customerCompanyId, customerCompanyId),
          )
        )
        .orderBy(clientTags.name)
        .then((rows) => rows.map((r) => r.tag));
    });
  }

  /** Get tag assignments for multiple customer companies (for list views) */
  async getTagAssignmentsByCompany(companyId: string) {
    this.assertCompanyId(companyId);
    return db
      .select({
        customerCompanyId: clientTagAssignments.customerCompanyId,
        tagId: clientTags.id,
        tagName: clientTags.name,
        tagColor: clientTags.color,
      })
      .from(clientTagAssignments)
      .innerJoin(clientTags, eq(clientTagAssignments.tagId, clientTags.id))
      .where(eq(clientTagAssignments.companyId, companyId));
  }

  // ── Phase 2A: Bulk Customer-Company Tag Updates ──────────────────────

  /**
   * Bulk assign/remove tags across multiple customer companies in a single transaction.
   * Validates all customerCompanyIds and tagIds belong to the tenant.
   * Uses set-based inserts/deletes (no per-row loops) for efficiency.
   */
  async bulkUpdateCustomerCompanyTags(
    companyId: string,
    customerCompanyIds: string[],
    addTagIds: string[],
    removeTagIds: string[],
  ): Promise<{ updatedCount: number }> {
    this.assertCompanyId(companyId);
    if (!customerCompanyIds.length) throw this.validationError("No customer company IDs provided");
    if (!addTagIds.length && !removeTagIds.length) throw this.validationError("No tags to add or remove");

    return this.tx(async (txDb) => {
      // Validate all customer companies belong to tenant
      const validCompanies = await txDb
        .select({ id: customerCompanies.id })
        .from(customerCompanies)
        .where(and(eq(customerCompanies.companyId, companyId), inArray(customerCompanies.id, customerCompanyIds)));
      const validCompanyIds = new Set(validCompanies.map((c) => c.id));
      const filteredCompanyIds = customerCompanyIds.filter((id) => validCompanyIds.has(id));
      if (!filteredCompanyIds.length) throw this.notFoundError("Customer companies");

      let affected = 0;

      // Remove tags (set-based delete across all companies + tags)
      if (removeTagIds.length > 0) {
        const deleted = await txDb
          .delete(clientTagAssignments)
          .where(
            and(
              eq(clientTagAssignments.companyId, companyId),
              inArray(clientTagAssignments.customerCompanyId, filteredCompanyIds),
              inArray(clientTagAssignments.tagId, removeTagIds),
            )
          )
          .returning({ id: clientTagAssignments.id });
        affected += deleted.length;
      }

      // Add tags (set-based insert with ON CONFLICT DO NOTHING for idempotency)
      if (addTagIds.length > 0) {
        // Validate all tags belong to this tenant
        const validTags = await txDb
          .select({ id: clientTags.id })
          .from(clientTags)
          .where(and(eq(clientTags.companyId, companyId), inArray(clientTags.id, addTagIds)));
        const validTagIds = new Set(validTags.map((t) => t.id));

        // Build cross-product of (companyId × customerCompanyId × tagId)
        const rows: { companyId: string; customerCompanyId: string; tagId: string }[] = [];
        for (const ccId of filteredCompanyIds) {
          for (const tagId of addTagIds) {
            if (validTagIds.has(tagId)) rows.push({ companyId, customerCompanyId: ccId, tagId });
          }
        }

        if (rows.length > 0) {
          const inserted = await txDb
            .insert(clientTagAssignments)
            .values(rows)
            .onConflictDoNothing()
            .returning({ id: clientTagAssignments.id });
          affected += inserted.length;
        }
      }

      return { updatedCount: filteredCompanyIds.length };
    });
  }

  // ── Phase 1B: Location Tag Assignments ──────────────────────

  /** Get all tags assigned to a specific location */
  async getTagsForLocation(companyId: string, locationId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(locationId, "locationId");
    return db
      .select({ tag: clientTags })
      .from(locationTagAssignments)
      .innerJoin(clientTags, eq(locationTagAssignments.tagId, clientTags.id))
      .where(
        and(
          eq(locationTagAssignments.companyId, companyId),
          eq(locationTagAssignments.locationId, locationId),
        )
      )
      .orderBy(clientTags.name)
      .then((rows) => rows.map((r) => r.tag));
  }

  /** Bulk assign/remove tags for a location */
  async updateLocationTags(
    companyId: string,
    locationId: string,
    addTagIds: string[],
    removeTagIds: string[],
  ) {
    this.assertCompanyId(companyId);
    this.validateUUID(locationId, "locationId");

    // Verify location belongs to tenant
    const [loc] = await db
      .select({ id: clientLocations.id })
      .from(clientLocations)
      .where(and(eq(clientLocations.id, locationId), eq(clientLocations.companyId, companyId)))
      .limit(1);
    if (!loc) throw this.notFoundError("Location");

    return this.tx(async (txDb) => {
      if (removeTagIds.length > 0) {
        await txDb
          .delete(locationTagAssignments)
          .where(
            and(
              eq(locationTagAssignments.companyId, companyId),
              eq(locationTagAssignments.locationId, locationId),
              inArray(locationTagAssignments.tagId, removeTagIds),
            )
          );
      }

      if (addTagIds.length > 0) {
        const validTags = await txDb
          .select({ id: clientTags.id })
          .from(clientTags)
          .where(and(eq(clientTags.companyId, companyId), inArray(clientTags.id, addTagIds)));
        const validIds = new Set(validTags.map((t) => t.id));

        const rows = addTagIds
          .filter((id) => validIds.has(id))
          .map((tagId) => ({ companyId, tagId, locationId }));

        if (rows.length > 0) {
          await txDb
            .insert(locationTagAssignments)
            .values(rows)
            .onConflictDoNothing();
        }
      }

      return txDb
        .select({ tag: clientTags })
        .from(locationTagAssignments)
        .innerJoin(clientTags, eq(locationTagAssignments.tagId, clientTags.id))
        .where(
          and(
            eq(locationTagAssignments.companyId, companyId),
            eq(locationTagAssignments.locationId, locationId),
          )
        )
        .orderBy(clientTags.name)
        .then((rows) => rows.map((r) => r.tag));
    });
  }

  // ── Phase 2B: Bulk Location Tag Updates ──────────────────────

  /**
   * Bulk assign/remove tags across multiple locations in a single transaction.
   * Validates all locationIds and tagIds belong to the tenant.
   * Uses set-based inserts/deletes (no per-row loops) for efficiency.
   */
  async bulkUpdateLocationTags(
    companyId: string,
    locationIds: string[],
    addTagIds: string[],
    removeTagIds: string[],
  ): Promise<{ updatedCount: number }> {
    this.assertCompanyId(companyId);
    if (!locationIds.length) throw this.validationError("No location IDs provided");
    if (!addTagIds.length && !removeTagIds.length) throw this.validationError("No tags to add or remove");

    return this.tx(async (txDb) => {
      // Validate all locations belong to tenant
      const validLocs = await txDb
        .select({ id: clientLocations.id })
        .from(clientLocations)
        .where(and(eq(clientLocations.companyId, companyId), inArray(clientLocations.id, locationIds)));
      const validLocIds = new Set(validLocs.map((l) => l.id));
      const filteredLocIds = locationIds.filter((id) => validLocIds.has(id));
      if (!filteredLocIds.length) throw this.notFoundError("Locations");

      // Remove tags (set-based delete across all locations + tags)
      if (removeTagIds.length > 0) {
        await txDb
          .delete(locationTagAssignments)
          .where(
            and(
              eq(locationTagAssignments.companyId, companyId),
              inArray(locationTagAssignments.locationId, filteredLocIds),
              inArray(locationTagAssignments.tagId, removeTagIds),
            )
          );
      }

      // Add tags (set-based insert with ON CONFLICT DO NOTHING for idempotency)
      if (addTagIds.length > 0) {
        const validTags = await txDb
          .select({ id: clientTags.id })
          .from(clientTags)
          .where(and(eq(clientTags.companyId, companyId), inArray(clientTags.id, addTagIds)));
        const validTagIds = new Set(validTags.map((t) => t.id));

        // Build cross-product of (companyId × locationId × tagId)
        const rows: { companyId: string; locationId: string; tagId: string }[] = [];
        for (const locId of filteredLocIds) {
          for (const tagId of addTagIds) {
            if (validTagIds.has(tagId)) rows.push({ companyId, locationId: locId, tagId });
          }
        }

        if (rows.length > 0) {
          await txDb
            .insert(locationTagAssignments)
            .values(rows)
            .onConflictDoNothing();
        }
      }

      return { updatedCount: filteredLocIds.length };
    });
  }

  /** Get location tag assignments for all locations in tenant (for list views) */
  async getLocationTagAssignmentsByCompany(companyId: string) {
    this.assertCompanyId(companyId);
    return db
      .select({
        locationId: locationTagAssignments.locationId,
        tagId: clientTags.id,
        tagName: clientTags.name,
        tagColor: clientTags.color,
      })
      .from(locationTagAssignments)
      .innerJoin(clientTags, eq(locationTagAssignments.tagId, clientTags.id))
      .where(eq(locationTagAssignments.companyId, companyId));
  }
}

export const clientTagRepository = new ClientTagRepository();
