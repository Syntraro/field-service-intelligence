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
  // Canonical create-or-get (2026-04-19)
  // =========================================================================
  //
  // Natural key: `(company_id, customer_company_id, lower(email))` when an
  // email is present. The matching partial unique index is in
  // `migrations/2026_04_19_contacts_unique_email_per_customer.sql`.
  //
  // Email is the strong dedupe signal — a contact's email is the closest
  // thing to a stable real-world identity in this domain. When email is
  // absent, we fall back to a softer cascade matching the field-tested
  // CSV-import dedupe pattern:
  //
  //   1. lower(email)                            — strong, also DB-enforced
  //   2. lower(name) + phone (both required)     — moderate
  //   3. lower(name) only                        — weakest, last resort
  //
  // Falls through to insert when no match. Returns the existing or
  // newly-inserted row in either case.
  //
  // The fallback path is intentionally NOT enforced by a unique index — two
  // different humans can legitimately share a name within a customer
  // (e.g., John Smith Sr. and Jr.). The application-layer cascade is the
  // best-effort dedupe; the email index is the safety net for the
  // overwhelmingly common case of a known email.

  private normalize(s: string | null | undefined): string {
    return (s ?? "").trim().toLowerCase();
  }

  /** Internal: run the email → name+phone → name cascade against a list. */
  private matchFromCascade(
    persons: ContactPerson[],
    data: Omit<InsertContactPerson, "companyId">,
  ): ContactPerson | null {
    const normalizedEmail = this.normalize(data.email);
    const fullName = `${(data.firstName ?? "").trim()} ${(data.lastName ?? "").trim()}`.trim();
    const normalizedName = fullName.toLowerCase();
    const normalizedPhone = this.normalize(data.phone);

    if (normalizedEmail) {
      const m = persons.find(p => this.normalize(p.email) === normalizedEmail);
      if (m) return m;
    }
    if (normalizedName && normalizedPhone) {
      const m = persons.find(p => {
        const pName = `${p.firstName} ${p.lastName}`.trim().toLowerCase();
        return pName === normalizedName && this.normalize(p.phone) === normalizedPhone;
      });
      if (m) return m;
    }
    if (normalizedName) {
      const m = persons.find(p => {
        const pName = `${p.firstName} ${p.lastName}`.trim().toLowerCase();
        return pName === normalizedName;
      });
      if (m) return m;
    }
    return null;
  }

  /**
   * Canonical create-or-get for contact persons. Returns the existing row
   * if the email → name+phone → name cascade matches, otherwise inserts.
   * The `created` flag tells callers (e.g. CSV importer) which path fired
   * without forcing a second lookup.
   */
  async createOrGetPerson(
    companyId: string,
    data: Omit<InsertContactPerson, "companyId">,
  ): Promise<{ contact: ContactPerson; created: boolean }> {
    this.assertCompanyId(companyId);
    const persons = await this.getCompanyPersons(companyId, data.customerCompanyId);
    const existing = this.matchFromCascade(persons, data);
    if (existing) return { contact: existing, created: false };
    const [row] = await db.insert(contactPersons).values({ ...data, companyId }).returning();
    return { contact: row, created: true };
  }

  /** Transaction variant. Same cascade; the read also goes through `tx`. */
  async createOrGetPersonTx(
    tx: any,
    companyId: string,
    data: Omit<InsertContactPerson, "companyId">,
  ): Promise<{ contact: ContactPerson; created: boolean }> {
    this.assertCompanyId(companyId);
    const persons: ContactPerson[] = await tx.select().from(contactPersons)
      .where(and(eq(contactPersons.companyId, companyId), eq(contactPersons.customerCompanyId, data.customerCompanyId)));
    const existing = this.matchFromCascade(persons, data);
    if (existing) return { contact: existing, created: false };
    const [row] = await tx.insert(contactPersons).values({ ...data, companyId }).returning();
    return { contact: row, created: true };
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
  async updatePerson(companyId: string, personId: string, data: Partial<Pick<ContactPerson, "firstName" | "lastName" | "title" | "jobTitle" | "email" | "phone" | "isPrimary">>): Promise<ContactPerson | undefined> {
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

  /**
   * Transaction variant of `assignToLocation` with idempotency.
   * Inserts a `contact_assignments` row only when no row already exists
   * for the same `(contactPersonId, locationId)` pair within the tenant
   * scope. Used by `POST /api/customer-companies/:companyId/locations`
   * to atomically link the inline-contact person to the newly created
   * location in the same transaction. Idempotent so re-submits or
   * dedup'd location creations do not produce twin assignments
   * (the schema has no unique constraint on the pair, so this is the
   * canonical guard).
   *
   * 2026-05-02: added because the prior route created the
   * contact_persons row but never created an assignment, leaving the
   * right-rail Contacts tab (which renders the assignment-flattened
   * `locationContacts` array) empty after Add Location with inline
   * contact fields.
   */
  async assignToLocationTx(
    tx: any,
    companyId: string,
    data: Omit<InsertContactAssignment, "companyId">,
  ): Promise<{ assignment: ContactAssignment; created: boolean }> {
    this.assertCompanyId(companyId);
    const existing: ContactAssignment[] = await tx
      .select()
      .from(contactAssignments)
      .where(and(
        eq(contactAssignments.companyId, companyId),
        eq(contactAssignments.contactPersonId, data.contactPersonId),
        eq(contactAssignments.locationId, data.locationId),
      ));
    if (existing.length > 0) {
      return { assignment: existing[0], created: false };
    }
    const [row] = await tx.insert(contactAssignments).values({ ...data, companyId }).returning();
    return { assignment: row, created: true };
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
  // 2026-04-20: legacy dedup helpers (findPersonByEmail,
  // findContactByEmail, findContactByNamePhone, findContactByName,
  // createContactTx, createPerson, createPersonTx, createPersons) deleted
  // — zero callers after the canonical createOrGetPerson(Tx) migration.
  // The email → name+phone → name cascade lives inside
  // `matchFromCascade` / `createOrGetPerson(Tx)` as the single source of
  // truth for contact dedupe.
  // =========================================================================
  // DTO adapters for the customer-company / location contact endpoints.
  //
  // The underlying model (contact_persons + contact_assignments) is canonical;
  // the {companyContacts, locationContacts} response shape these methods build
  // is the legacy WIRE FORMAT that ClientDetailPage still consumes. Both
  // adapters are real production paths — only the DTO is legacy, not the
  // route, the data, or the storage primitives below.
  // =========================================================================

  /**
   * Customer-company contacts view — full directory + every assignment across
   * every location, flattened into the legacy {companyContacts, locationContacts}
   * DTO consumed by GET /api/customer-companies/:companyId/contacts.
   */
  async getContactsForCustomerCompany(companyId: string, customerCompanyId: string) {
    const directory = await this.getCompanyDirectory(companyId, customerCompanyId);
    // Company contacts = all persons (the directory)
    // 2026-05-02 honorific split: surface `title` (honorific) and
    // `jobTitle` so the canonical Add/Edit Contact modal can render
    // them without a second fetch.
    const companyContacts = directory.map(p => ({
      id: p.id, companyId: p.companyId, customerCompanyId: p.customerCompanyId,
      firstName: p.firstName, lastName: p.lastName,
      title: p.title, jobTitle: p.jobTitle,
      email: p.email, phone: p.phone,
      isPrimary: p.isPrimary, roles: [] as string[], locationId: null as string | null,
      createdAt: p.createdAt, updatedAt: p.updatedAt,
      assignmentCount: p.assignments.length,
    }));
    // Location contacts = flattened assignments with person identity
    const locationContacts = directory.flatMap(p =>
      p.assignments.map(a => ({
        id: a.id, companyId: p.companyId, customerCompanyId: p.customerCompanyId,
        contactPersonId: p.id,
        firstName: p.firstName, lastName: p.lastName,
        title: p.title, jobTitle: p.jobTitle,
        email: p.email, phone: p.phone,
        isPrimary: p.isPrimary, roles: a.roles, locationId: a.locationId,
        createdAt: a.createdAt, updatedAt: a.updatedAt,
      }))
    );
    return { companyContacts, locationContacts };
  }

  /**
   * Location contacts view — parent-company directory (so the UI's "assign
   * existing" picker has its data) + only THIS location's assignments,
   * flattened into the legacy {companyContacts, locationContacts} DTO
   * consumed by GET /api/clients/:clientId/contacts.
   */
  async getContactsForLocation(companyId: string, locationId: string, customerCompanyId: string) {
    const allPersons = await this.getCompanyPersons(companyId, customerCompanyId);
    const locationAssigned = await this.getLocationContacts(companyId, locationId);
    // 2026-05-02 honorific split: same surface contract as the
    // customer-company DTO above. `title` is honorific; `jobTitle`
    // is the freeform professional role.
    const companyContacts = allPersons.map(p => ({
      id: p.id, companyId: p.companyId, customerCompanyId: p.customerCompanyId,
      firstName: p.firstName, lastName: p.lastName,
      title: p.title, jobTitle: p.jobTitle,
      email: p.email, phone: p.phone,
      isPrimary: p.isPrimary, roles: [] as string[], locationId: null as string | null,
      createdAt: p.createdAt, updatedAt: p.updatedAt,
    }));
    const locationContacts = locationAssigned.map(lc => ({
      id: lc.assignment.id, companyId: lc.companyId, customerCompanyId: lc.customerCompanyId,
      contactPersonId: lc.id,
      firstName: lc.firstName, lastName: lc.lastName,
      title: lc.title, jobTitle: lc.jobTitle,
      email: lc.email, phone: lc.phone,
      isPrimary: lc.isPrimary, roles: lc.assignment.roles, locationId: lc.assignment.locationId,
      createdAt: lc.assignment.createdAt, updatedAt: lc.assignment.updatedAt,
    }));
    return { companyContacts, locationContacts };
  }
}

export const clientContactRepository = new ClientContactRepository();
