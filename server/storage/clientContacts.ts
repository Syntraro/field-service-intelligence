import { db } from "../db";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { clientContacts } from "@shared/schema";
import type { ClientContact, InsertClientContact } from "@shared/schema";
import { BaseRepository } from "./base";

/**
 * Repository for client_contacts table.
 * Contacts belong to a customer_company and optionally to a specific location.
 */
export class ClientContactRepository extends BaseRepository {
  /**
   * Bulk create contacts for a customer company (and optionally locations).
   * Used during full-create flow.
   */
  async createContacts(
    companyId: string,
    contacts: InsertClientContact[]
  ): Promise<ClientContact[]> {
    if (contacts.length === 0) return [];
    this.assertCompanyId(companyId);

    const rows = await db
      .insert(clientContacts)
      .values(
        contacts.map((c) => ({
          companyId,
          customerCompanyId: c.customerCompanyId,
          locationId: c.locationId ?? null,
          firstName: c.firstName ?? "",
          lastName: c.lastName ?? "",
          email: c.email ?? null,
          phone: c.phone ?? null,
          roles: c.roles ?? [],
          isPrimary: c.isPrimary ?? false,
        }))
      )
      .returning();

    return rows;
  }

  /**
   * Get all contacts for a customer company (company-level only, locationId IS NULL).
   */
  async getCompanyContacts(
    companyId: string,
    customerCompanyId: string
  ): Promise<ClientContact[]> {
    this.assertCompanyId(companyId);
    return await db
      .select()
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.companyId, companyId),
          eq(clientContacts.customerCompanyId, customerCompanyId),
          isNull(clientContacts.locationId)
        )
      );
  }

  /**
   * Get contacts for a specific location.
   */
  async getLocationContacts(
    companyId: string,
    locationId: string
  ): Promise<ClientContact[]> {
    this.assertCompanyId(companyId);
    return await db
      .select()
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.companyId, companyId),
          eq(clientContacts.locationId, locationId)
        )
      );
  }

  /**
   * Get ALL contacts for a customer company (both company-level and location-level).
   */
  async getAllContactsForCustomerCompany(
    companyId: string,
    customerCompanyId: string
  ): Promise<ClientContact[]> {
    this.assertCompanyId(companyId);
    return await db
      .select()
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.companyId, companyId),
          eq(clientContacts.customerCompanyId, customerCompanyId)
        )
      );
  }

  /**
   * Get a single contact by ID, scoped to tenant.
   */
  async getContactById(
    companyId: string,
    contactId: string
  ): Promise<ClientContact | undefined> {
    this.assertCompanyId(companyId);
    const rows = await db
      .select()
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.companyId, companyId),
          eq(clientContacts.id, contactId)
        )
      );
    return rows[0];
  }

  /**
   * Create a single contact for a customer company.
   */
  async createContact(
    companyId: string,
    data: Omit<InsertClientContact, "companyId">
  ): Promise<ClientContact> {
    this.assertCompanyId(companyId);
    const [row] = await db
      .insert(clientContacts)
      .values({
        companyId,
        customerCompanyId: data.customerCompanyId,
        locationId: data.locationId ?? null,
        firstName: data.firstName ?? "",
        lastName: data.lastName ?? "",
        email: data.email ?? null,
        phone: data.phone ?? null,
        roles: data.roles ?? [],
        isPrimary: data.isPrimary ?? false,
      })
      .returning();
    return row;
  }

  /**
   * Update a single contact by ID, scoped to tenant.
   */
  async updateContact(
    companyId: string,
    contactId: string,
    data: Partial<Pick<ClientContact, "firstName" | "lastName" | "email" | "phone" | "roles" | "isPrimary" | "locationId">>
  ): Promise<ClientContact | undefined> {
    this.assertCompanyId(companyId);
    const rows = await db
      .update(clientContacts)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(clientContacts.companyId, companyId),
          eq(clientContacts.id, contactId)
        )
      )
      .returning();
    return rows[0];
  }

  /**
   * Delete a single contact by ID, scoped to tenant.
   */
  async deleteContact(
    companyId: string,
    contactId: string
  ): Promise<boolean> {
    this.assertCompanyId(companyId);
    const rows = await db
      .delete(clientContacts)
      .where(
        and(
          eq(clientContacts.companyId, companyId),
          eq(clientContacts.id, contactId)
        )
      )
      .returning();
    return rows.length > 0;
  }

  /**
   * Delete all contacts for a customer company (used for replace-all-on-edit pattern).
   */
  async deleteContactsByCustomerCompany(
    companyId: string,
    customerCompanyId: string
  ): Promise<number> {
    this.assertCompanyId(companyId);
    const rows = await db
      .delete(clientContacts)
      .where(
        and(
          eq(clientContacts.companyId, companyId),
          eq(clientContacts.customerCompanyId, customerCompanyId)
        )
      )
      .returning();
    return rows.length;
  }

  /**
   * Atomically replace all association rows for a person.
   * Deletes existing rows by ID, then inserts new rows — all in one transaction.
   * Used when editing a contact's association/role assignments.
   */
  async replacePersonContacts(
    companyId: string,
    customerCompanyId: string,
    existingIds: string[],
    newRows: Omit<InsertClientContact, "companyId">[]
  ): Promise<ClientContact[]> {
    this.assertCompanyId(companyId);

    return await db.transaction(async (tx) => {
      // Delete all old association rows for this person (tenant-scoped)
      if (existingIds.length > 0) {
        await tx
          .delete(clientContacts)
          .where(
            and(
              eq(clientContacts.companyId, companyId),
              eq(clientContacts.customerCompanyId, customerCompanyId),
              inArray(clientContacts.id, existingIds)
            )
          );
      }

      // Insert new association rows
      if (newRows.length === 0) return [];
      const inserted = await tx
        .insert(clientContacts)
        .values(
          newRows.map((r) => ({
            companyId,
            customerCompanyId,
            locationId: r.locationId ?? null,
            firstName: r.firstName ?? "",
            lastName: r.lastName ?? "",
            email: r.email ?? null,
            phone: r.phone ?? null,
            roles: r.roles ?? [],
            isPrimary: r.isPrimary ?? false,
          }))
        )
        .returning();

      return inserted;
    });
  }
}

export const clientContactRepository = new ClientContactRepository();
