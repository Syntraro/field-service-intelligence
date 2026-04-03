/**
 * Contact Repository — Identity + Assignment model.
 *
 * contact_persons: one row per human, owned by customer company
 * contact_assignments: links person to location with roles
 *
 * Company-level contacts = persons with no assignments (or persons directory)
 * Location contacts = persons assigned to that location via contact_assignments
 */
import { db } from "../db";
import { eq, and, inArray } from "drizzle-orm";
import { contactPersons, contactAssignments } from "@shared/schema";
import type { ContactPerson, InsertContactPerson, ContactAssignment, InsertContactAssignment } from "@shared/schema";
import { BaseRepository } from "./base";

export class ClientContactRepository extends BaseRepository {

  // =========================================================================
  // Person CRUD
  // =========================================================================

  /** Create a person record (company-level identity). */
  async createPerson(companyId: string, data: Omit<InsertContactPerson, "companyId">): Promise<ContactPerson> {
    this.assertCompanyId(companyId);
    const [row] = await db.insert(contactPersons).values({ ...data, companyId }).returning();
    return row;
  }

  /** Create a person in an external transaction (used by full-create flow). */
  async createPersonTx(tx: any, companyId: string, data: Omit<InsertContactPerson, "companyId">): Promise<ContactPerson> {
    this.assertCompanyId(companyId);
    const [row] = await tx.insert(contactPersons).values({ ...data, companyId }).returning();
    return row;
  }

  /** Bulk create persons. */
  async createPersons(companyId: string, persons: Omit<InsertContactPerson, "companyId">[]): Promise<ContactPerson[]> {
    if (persons.length === 0) return [];
    this.assertCompanyId(companyId);
    return db.insert(contactPersons).values(persons.map(p => ({ ...p, companyId }))).returning();
  }

  /** Get a single person by ID. */
  async getPersonById(companyId: string, personId: string): Promise<ContactPerson | undefined> {
    this.assertCompanyId(companyId);
    const [row] = await db.select().from(contactPersons)
      .where(and(eq(contactPersons.companyId, companyId), eq(contactPersons.id, personId)));
    return row;
  }

  /** Get all persons for a customer company (the company directory). */
  async getCompanyPersons(companyId: string, customerCompanyId: string): Promise<ContactPerson[]> {
    this.assertCompanyId(companyId);
    return db.select().from(contactPersons)
      .where(and(eq(contactPersons.companyId, companyId), eq(contactPersons.customerCompanyId, customerCompanyId)));
  }

  /** Update person identity fields. */
  async updatePerson(companyId: string, personId: string, data: Partial<Pick<ContactPerson, "firstName" | "lastName" | "email" | "phone" | "isPrimary">>): Promise<ContactPerson | undefined> {
    this.assertCompanyId(companyId);
    const [row] = await db.update(contactPersons)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(contactPersons.companyId, companyId), eq(contactPersons.id, personId)))
      .returning();
    return row;
  }

  /** Delete a person (cascades to assignments via FK). */
  async deletePerson(companyId: string, personId: string): Promise<boolean> {
    this.assertCompanyId(companyId);
    const rows = await db.delete(contactPersons)
      .where(and(eq(contactPersons.companyId, companyId), eq(contactPersons.id, personId)))
      .returning();
    return rows.length > 0;
  }

  // =========================================================================
  // Assignment CRUD
  // =========================================================================

  /** Assign a person to a location with roles. */
  async assignToLocation(companyId: string, data: Omit<InsertContactAssignment, "companyId">): Promise<ContactAssignment> {
    this.assertCompanyId(companyId);
    const [row] = await db.insert(contactAssignments).values({ ...data, companyId }).returning();
    return row;
  }

  /** Get all assignments for a location. */
  async getLocationAssignments(companyId: string, locationId: string): Promise<ContactAssignment[]> {
    this.assertCompanyId(companyId);
    return db.select().from(contactAssignments)
      .where(and(eq(contactAssignments.companyId, companyId), eq(contactAssignments.locationId, locationId)));
  }

  /** Get all assignments for a person. */
  async getPersonAssignments(companyId: string, personId: string): Promise<ContactAssignment[]> {
    this.assertCompanyId(companyId);
    return db.select().from(contactAssignments)
      .where(and(eq(contactAssignments.companyId, companyId), eq(contactAssignments.contactPersonId, personId)));
  }

  /** Update assignment roles. */
  async updateAssignment(companyId: string, assignmentId: string, data: { roles: string[] }): Promise<ContactAssignment | undefined> {
    this.assertCompanyId(companyId);
    const [row] = await db.update(contactAssignments)
      .set({ roles: data.roles, updatedAt: new Date() })
      .where(and(eq(contactAssignments.companyId, companyId), eq(contactAssignments.id, assignmentId)))
      .returning();
    return row;
  }

  /** Remove assignment (unassign person from location). Does NOT delete the person. */
  async deleteAssignment(companyId: string, assignmentId: string): Promise<boolean> {
    this.assertCompanyId(companyId);
    const rows = await db.delete(contactAssignments)
      .where(and(eq(contactAssignments.companyId, companyId), eq(contactAssignments.id, assignmentId)))
      .returning();
    return rows.length > 0;
  }

  // =========================================================================
  // Composite queries (for API responses)
  // =========================================================================

  /** Get persons + their assignments for a customer company (company directory view). */
  async getCompanyDirectory(companyId: string, customerCompanyId: string): Promise<(ContactPerson & { assignments: ContactAssignment[] })[]> {
    this.assertCompanyId(companyId);
    const persons = await this.getCompanyPersons(companyId, customerCompanyId);
    if (persons.length === 0) return [];
    const personIds = persons.map(p => p.id);
    const assignments = await db.select().from(contactAssignments)
      .where(and(eq(contactAssignments.companyId, companyId), inArray(contactAssignments.contactPersonId, personIds)));
    const assignmentMap = new Map<string, ContactAssignment[]>();
    for (const a of assignments) {
      const list = assignmentMap.get(a.contactPersonId) || [];
      list.push(a);
      assignmentMap.set(a.contactPersonId, list);
    }
    return persons.map(p => ({ ...p, assignments: assignmentMap.get(p.id) || [] }));
  }

  /** Get persons assigned to a location (location contacts view). */
  async getLocationContacts(companyId: string, locationId: string): Promise<(ContactPerson & { assignment: ContactAssignment })[]> {
    this.assertCompanyId(companyId);
    const assignments = await this.getLocationAssignments(companyId, locationId);
    if (assignments.length === 0) return [];
    const personIds = Array.from(new Set(assignments.map(a => a.contactPersonId)));
    const persons = await db.select().from(contactPersons)
      .where(and(eq(contactPersons.companyId, companyId), inArray(contactPersons.id, personIds)));
    const personMap = new Map(persons.map(p => [p.id, p]));
    return assignments
      .filter(a => personMap.has(a.contactPersonId))
      .map(a => ({ ...personMap.get(a.contactPersonId)!, assignment: a }));
  }

  // =========================================================================
  // Dedup helpers (used by CSV import and similar flows)
  // =========================================================================

  async findPersonByEmail(companyId: string, customerCompanyId: string, email: string): Promise<ContactPerson | null> {
    if (!email) return null;
    const normalized = email.trim().toLowerCase();
    const persons = await this.getCompanyPersons(companyId, customerCompanyId);
    return persons.find(p => p.email?.trim().toLowerCase() === normalized) ?? null;
  }

  // Legacy-compatible aliases for import service
  async findContactByEmail(companyId: string, customerCompanyId: string, normalizedEmail: string) {
    return this.findPersonByEmail(companyId, customerCompanyId, normalizedEmail);
  }
  async findContactByNamePhone(companyId: string, customerCompanyId: string, normalizedName: string, normalizedPhone: string) {
    if (!normalizedName || !normalizedPhone) return null;
    const persons = await this.getCompanyPersons(companyId, customerCompanyId);
    return persons.find(p => {
      const fullName = `${p.firstName} ${p.lastName}`.trim().toLowerCase();
      const phone = (p.phone || "").trim().toLowerCase();
      return fullName === normalizedName && phone === normalizedPhone;
    }) ?? null;
  }
  async findContactByName(companyId: string, customerCompanyId: string, normalizedName: string) {
    if (!normalizedName) return null;
    const persons = await this.getCompanyPersons(companyId, customerCompanyId);
    return persons.find(p => {
      const fullName = `${p.firstName} ${p.lastName}`.trim().toLowerCase();
      return fullName === normalizedName;
    }) ?? null;
  }
  async createContactTx(tx: any, companyId: string, data: any) {
    return this.createPersonTx(tx, companyId, {
      customerCompanyId: data.customerCompanyId,
      firstName: data.firstName ?? "",
      lastName: data.lastName ?? "",
      email: data.email ?? null,
      phone: data.phone ?? null,
      isPrimary: data.isPrimary ?? false,
    });
  }

  // =========================================================================
  // Legacy compatibility — adapts old API response shape
  // =========================================================================

  /** Returns { companyContacts, locationContacts } matching old API contract. */
  async getLegacyContactsForCustomerCompany(companyId: string, customerCompanyId: string) {
    const directory = await this.getCompanyDirectory(companyId, customerCompanyId);
    // Company contacts = all persons (the directory)
    const companyContacts = directory.map(p => ({
      id: p.id, companyId: p.companyId, customerCompanyId: p.customerCompanyId,
      firstName: p.firstName, lastName: p.lastName, email: p.email, phone: p.phone,
      isPrimary: p.isPrimary, roles: [] as string[], locationId: null as string | null,
      createdAt: p.createdAt, updatedAt: p.updatedAt,
      assignmentCount: p.assignments.length,
    }));
    // Location contacts = flattened assignments with person identity
    const locationContacts = directory.flatMap(p =>
      p.assignments.map(a => ({
        id: a.id, companyId: p.companyId, customerCompanyId: p.customerCompanyId,
        contactPersonId: p.id,
        firstName: p.firstName, lastName: p.lastName, email: p.email, phone: p.phone,
        isPrimary: p.isPrimary, roles: a.roles, locationId: a.locationId,
        createdAt: a.createdAt, updatedAt: a.updatedAt,
      }))
    );
    return { companyContacts, locationContacts };
  }

  /** Returns { companyContacts, locationContacts } for a specific location. */
  async getLegacyContactsForLocation(companyId: string, locationId: string, customerCompanyId: string) {
    const allPersons = await this.getCompanyPersons(companyId, customerCompanyId);
    const locationAssigned = await this.getLocationContacts(companyId, locationId);
    const companyContacts = allPersons.map(p => ({
      id: p.id, companyId: p.companyId, customerCompanyId: p.customerCompanyId,
      firstName: p.firstName, lastName: p.lastName, email: p.email, phone: p.phone,
      isPrimary: p.isPrimary, roles: [] as string[], locationId: null as string | null,
      createdAt: p.createdAt, updatedAt: p.updatedAt,
    }));
    const locationContacts = locationAssigned.map(lc => ({
      id: lc.assignment.id, companyId: lc.companyId, customerCompanyId: lc.customerCompanyId,
      contactPersonId: lc.id,
      firstName: lc.firstName, lastName: lc.lastName, email: lc.email, phone: lc.phone,
      isPrimary: lc.isPrimary, roles: lc.assignment.roles, locationId: lc.assignment.locationId,
      createdAt: lc.assignment.createdAt, updatedAt: lc.assignment.updatedAt,
    }));
    return { companyContacts, locationContacts };
  }
}

export const clientContactRepository = new ClientContactRepository();
