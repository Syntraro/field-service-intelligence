import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { eq, and, inArray } from "drizzle-orm";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { parsePaginationLenient } from "../utils/pagination";
import { paginatedCompat } from "../utils/paginatedResponse";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest } from "../auth/tenantIsolation";
import { customerCompanyRepository } from "../storage/customerCompanies";
import { clientContactRepository } from "../storage/clientContacts";
import { db } from "../db";
import { clientLocations } from "@shared/schema";
import {
  INVALID_EMAIL_MESSAGE,
  isValidOptionalEmail,
} from "@shared/lib/emailValidation";

/**
 * Phase 3: Validate that all locationIds belong to the given customerCompany.
 * Prevents cross-company contact association via crafted requests.
 */
async function validateLocationOwnership(
  tenantCompanyId: string,
  customerCompanyId: string,
  locationIds: string[],
): Promise<void> {
  if (locationIds.length === 0) return;
  const uniqueIds = Array.from(new Set(locationIds));
  const rows = await db
    .select({ id: clientLocations.id })
    .from(clientLocations)
    .where(
      and(
        eq(clientLocations.companyId, tenantCompanyId),
        eq(clientLocations.parentCompanyId, customerCompanyId),
        inArray(clientLocations.id, uniqueIds),
      )
    );
  if (rows.length !== uniqueIds.length) {
    throw createError(400, "One or more locationIds do not belong to this customer company");
  }
}

function requireCompanyContext(req: any, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  if (!req.companyId) return res.status(400).json({ error: "Missing company context" });
  next();
}

const router = Router();
router.use(requireCompanyContext);

/**
 * GET /api/customer-companies
 * Returns a lightweight list of all customer companies for the tenant (id + name).
 * Used by PM wizard company picker and other selectors.
 */
router.get("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId } = req;
  const list = await customerCompanyRepository.listCustomerCompanies(companyId!);
  res.json(list);
}));

/**
 * GET /api/customer-companies/:companyId
 * Returns the customer company record for the current tenant (companyId context).
 */
router.get("/:companyId", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId } = req;
  const { companyId } = req.params;

  const company = await customerCompanyRepository.getCustomerCompany(tenantCompanyId!, companyId);
  if (!company) throw createError(404, "Customer company not found");
  res.json(company);
}));

/**
 * GET /api/customer-companies/:companyId/locations
 * Returns locations (clients) belonging to the customer company.
 */
router.get("/:companyId/locations", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId } = req;
  const { companyId } = req.params;
  const { params, explicit } = parsePaginationLenient(req.query);

  const offset = params.offset ?? 0;

  // Repository handles company existence check and pagination
  const result = await customerCompanyRepository.getCustomerCompanyLocations(
    tenantCompanyId!,
    companyId,
    { limit: params.limit, offset }
  );

  const meta = {
    limit: params.limit,
    hasMore: result.hasMore,
    nextOffset: result.nextOffset,
  };

  res.json(paginatedCompat(result.items, meta, explicit));
}));
/**
 * POST /api/customer-companies/:companyId/locations
 * Create a new location under a customer company
 */
router.post("/:companyId/locations", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId, user } = req;
  const { companyId } = req.params;

  // Repository handles company existence check
  const contactName = req.body.contactName || null;
  const contactEmail = req.body.email || null;
  const contactPhone = req.body.phone || null;

  const hasInlineContact = !!(contactName || contactEmail || contactPhone);

  // Part A: If inline contact fields are present, create location + contact atomically
  // in a single DB transaction. No partial-save state possible — if contact creation
  // fails, the location creation is rolled back and a proper error response is returned.
  if (hasInlineContact) {
    const nameParts = (contactName || "").trim().split(/\s+/);
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || "";

    const newLocation = await db.transaction(async (tx) => {
      // Step 1: Create location within transaction
      const location = await customerCompanyRepository.createLocationUnderCustomerCompanyTx(
        tx,
        tenantCompanyId,
        user.id,
        companyId,
        {
          location: req.body.location || "",
          address: req.body.address || null,
          city: req.body.city || null,
          province: req.body.province || null,
          postalCode: req.body.postalCode || null,
          contactName,
          email: contactEmail,
          phone: contactPhone,
          roofLadderCode: req.body.roofLadderCode || null,
          billWithParent: req.body.billWithParent ?? true,
          inactive: req.body.inactive ?? false,
        }
      );

      // Step 2: Create client_contacts record within same transaction
      await clientContactRepository.createContactTx(tx, tenantCompanyId!, {
        customerCompanyId: companyId,
        locationId: location.id,
        firstName,
        lastName,
        email: contactEmail,
        phone: contactPhone,
        roles: [],
        isPrimary: true,
      });

      return location;
    });

    res.status(201).json(newLocation);
  } else {
    // No inline contact — create location normally (no transaction needed)
    const newLocation = await customerCompanyRepository.createLocationUnderCustomerCompany(
      tenantCompanyId,
      user.id,
      companyId,
      {
        location: req.body.location || "",
        address: req.body.address || null,
        city: req.body.city || null,
        province: req.body.province || null,
        postalCode: req.body.postalCode || null,
        contactName: null,
        email: null,
        phone: null,
        roofLadderCode: req.body.roofLadderCode || null,
        billWithParent: req.body.billWithParent ?? true,
        inactive: req.body.inactive ?? false,
      }
    );

    res.status(201).json(newLocation);
  }
}));
/**
 * GET /api/customer-companies/:companyId/overview
 * Single, canonical endpoint for the Company/Client detail page.
 * Aggregates jobs/invoices through locationIds (schema-correct, scalable, QBO-aligned).
 */
router.get("/:companyId/overview", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId } = req;
  const { companyId } = req.params;

  const overview = await customerCompanyRepository.getCustomerCompanyOverview(
    tenantCompanyId!,
    companyId
  );

  if (!overview) throw createError(404, "Customer company not found");

  res.json(overview);
}));

/**
 * PATCH /api/customer-companies/:companyId
 * Update customer company properties (name, phone, email, billing address, active status).
 */
const updateCustomerCompanySchema = z.object({
  name: z.string().max(200).nullable().optional(),
  firstName: z.string().max(100).nullable().optional(),
  lastName: z.string().max(100).nullable().optional(),
  useCompanyAsPrimary: z.boolean().optional(),
  phone: z.string().max(50).nullable().optional(),
  email: z.string().max(200).nullable().optional(),
  billingStreet: z.string().max(200).nullable().optional(),
  billingStreet2: z.string().max(200).nullable().optional(),
  billingCity: z.string().max(100).nullable().optional(),
  billingProvince: z.string().max(100).nullable().optional(),
  billingPostalCode: z.string().max(20).nullable().optional(),
  billingCountry: z.string().max(100).nullable().optional(),
  isActive: z.boolean().optional(),
}).strict();

router.patch("/:companyId", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId } = req;
  const { companyId: customerCompanyId } = req.params;

  const validated = validateSchema(updateCustomerCompanySchema, req.body);

  // If both name fields are being explicitly cleared, reject
  if (validated.name !== undefined && validated.firstName !== undefined) {
    if (!validated.name?.trim() && !validated.firstName?.trim()) {
      throw createError(400, "At least a first name or company name is required");
    }
  }

  // Sync nameSource for backward compat
  if (validated.useCompanyAsPrimary !== undefined) {
    (validated as any).nameSource = validated.useCompanyAsPrimary ? "company" : "person";
  }

  const updated = await customerCompanyRepository.updateCustomerCompany(
    tenantCompanyId!,
    customerCompanyId,
    validated,
  );

  if (!updated) throw createError(404, "Customer company not found");

  // TODO(QBO-SYNC): After successful company update, invoke non-blocking QBO customer sync here.
  // Pattern: check if company has qboCustomerId, then call qboSyncService.syncCustomer(updated)
  // in a fire-and-forget fashion (no await, catch errors to avoid failing the main response).
  // See server/qbo/syncService.ts for the established sync pattern.

  res.json(updated);
}));

/**
 * GET /api/customer-companies/:companyId/contacts
 * Returns all contacts for a customer company, split into company-level and location-level.
 * Used by the Client Detail Page to show contacts across all locations.
 */
router.get("/:companyId/contacts", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId } = req;
  const { companyId: customerCompanyId } = req.params;

  // Identity + Assignment model: returns company directory + flattened location assignments
  const result = await clientContactRepository.getLegacyContactsForCustomerCompany(
    tenantCompanyId!,
    customerCompanyId
  );

  res.json(result);
}));

// Validation: name present + (phone or email)
// Phase 5: association.locations[] carries per-location roles
const contactFieldsSchema = z.object({
  firstName: z.string().optional().default(""),
  lastName: z.string().optional().default(""),
  phone: z.string().optional().nullable(),
  // 2026-04-14: shape-validate emails at the API boundary so bad data
  // (e.g. "huda@huda") never lands in `contact_persons.email`.
  email: z
    .string()
    .optional()
    .nullable()
    .refine(isValidOptionalEmail, { message: INVALID_EMAIL_MESSAGE }),
  roles: z.array(z.string()).optional().default([]),
  isPrimary: z.boolean().optional().default(false),
  association: z.object({
    type: z.enum(["company", "locations"]),
    locationIds: z.array(z.string().uuid()).optional().default([]),
    // Per-location roles (Phase 5): each entry has its own roles array
    locations: z.array(z.object({
      locationId: z.string().uuid(),
      roles: z.array(z.string()).optional().default([]),
    })).optional().default([]),
  }).optional().default({ type: "company", locationIds: [], locations: [] }),
}).refine(
  (d) => (d.firstName?.trim()),
  { message: "First name is required" }
);

/**
 * POST /api/customer-companies/:companyId/contacts
 * Create contact(s) for a customer company.
 * association.type = "company" → one row with locationId = null, uses top-level roles
 * association.type = "locations" + locations[] → one row per entry with per-location roles (Phase 5)
 * association.type = "locations" + locationIds[] → legacy: one row per locationId, same roles
 */
router.post("/:companyId/contacts", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId } = req;
  const { companyId: customerCompanyId } = req.params;

  const data = validateSchema(contactFieldsSchema, req.body);
  const { association: rawAssociation, ...contactFields } = data;
  const association = rawAssociation ?? { type: "company" as const, locationIds: [] as string[], locations: [] };
  const locationsWithRoles = association.locations ?? [];
  const locationIds = association.locationIds ?? [];

  // Identity + Assignment model: always create ONE person record first
  const person = await clientContactRepository.createPerson(tenantCompanyId!, {
    customerCompanyId,
    firstName: contactFields.firstName ?? "",
    lastName: contactFields.lastName ?? "",
    phone: contactFields.phone ?? null,
    email: contactFields.email ?? null,
    isPrimary: contactFields.isPrimary,
  });

  // Then create location assignments if requested
  if (association.type === "locations" && locationsWithRoles.length > 0) {
    await validateLocationOwnership(tenantCompanyId!, customerCompanyId, locationsWithRoles.map(l => l.locationId));
    for (const loc of locationsWithRoles) {
      await clientContactRepository.assignToLocation(tenantCompanyId!, {
        contactPersonId: person.id, locationId: loc.locationId, roles: loc.roles,
      });
    }
  } else if (association.type === "locations" && locationIds.length > 0) {
    await validateLocationOwnership(tenantCompanyId!, customerCompanyId, locationIds);
    for (const locId of locationIds) {
      await clientContactRepository.assignToLocation(tenantCompanyId!, {
        contactPersonId: person.id, locationId: locId, roles: contactFields.roles ?? [],
      });
    }
  }
  // Company-wide contacts (no assignments) are just person records in the directory

  res.status(201).json(person);
}));

/**
 * Schema for full-association contact update.
 * Accepts identity fields + association payload + list of existing row IDs to replace.
 * When association is provided, all existing rows (existingContactIds) are deleted
 * and new rows are inserted atomically in a transaction.
 */
const updateContactSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  phone: z.string().optional().nullable(),
  email: z
    .string()
    .optional()
    .nullable()
    .refine(isValidOptionalEmail, { message: INVALID_EMAIL_MESSAGE }),
  roles: z.array(z.string()).optional(),
  isPrimary: z.boolean().optional(),
  locationId: z.string().uuid().nullable().optional(),
  // Full association payload for transactional replace
  association: z.object({
    type: z.enum(["company", "locations"]),
    roles: z.array(z.string()).optional().default([]),
    locations: z.array(z.object({
      locationId: z.string().uuid(),
      roles: z.array(z.string()).optional().default([]),
    })).optional().default([]),
  }).optional(),
  // All existing DB row IDs for this person (used for delete-and-replace)
  existingContactIds: z.array(z.string()).optional(),
});

/**
 * PATCH /api/customer-companies/:companyId/contacts/:contactId
 * Update a contact. When association + existingContactIds are provided,
 * atomically replaces all association rows in a transaction.
 * Otherwise falls back to single-row update for backward compat.
 */
router.patch("/:companyId/contacts/:contactId", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId } = req;
  const { contactId } = req.params;

  // Identity + Assignment model: contactId is a person ID. Update person identity.
  const existing = await clientContactRepository.getPersonById(tenantCompanyId!, contactId);
  if (!existing) throw createError(404, "Contact not found");

  const data = validateSchema(updateContactSchema, req.body);

  const merged = {
    firstName: data.firstName ?? existing.firstName,
    lastName: data.lastName ?? existing.lastName,
    phone: data.phone !== undefined ? data.phone : existing.phone,
    email: data.email !== undefined ? data.email : existing.email,
  };
  // Only firstName is required
  if (!merged.firstName?.trim()) {
    throw createError(400, "First name is required");
  }

  // Update person identity fields only
  const updated = await clientContactRepository.updatePerson(tenantCompanyId!, contactId, {
    firstName: merged.firstName,
    lastName: merged.lastName,
    phone: merged.phone ?? null,
    email: merged.email ?? null,
    isPrimary: data.isPrimary ?? existing.isPrimary,
  });
  if (!updated) throw createError(404, "Contact not found");

  res.json(updated);
}));

/**
 * DELETE /api/customer-companies/:companyId/contacts/:contactId
 * Delete a single contact.
 */
router.delete("/:companyId/contacts/:contactId", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId } = req;
  const { contactId } = req.params;

  // Identity + Assignment model: deleting a person cascades to all their assignments via FK
  const deleted = await clientContactRepository.deletePerson(tenantCompanyId!, contactId);
  if (!deleted) throw createError(404, "Contact not found");

  res.json({ success: true });
}));

// ============================================================================
// Contact Assignments — assign/unassign persons to locations
// ============================================================================

/**
 * POST /api/customer-companies/:companyId/contacts/:contactId/assign
 * Assign an existing person to a location with roles.
 */
router.post("/:companyId/contacts/:contactId/assign", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId } = req;
  const { contactId } = req.params;
  const { locationId, roles = [] } = req.body;
  if (!locationId) throw createError(400, "locationId is required");

  const person = await clientContactRepository.getPersonById(tenantCompanyId!, contactId);
  if (!person) throw createError(404, "Contact not found");

  const assignment = await clientContactRepository.assignToLocation(tenantCompanyId!, {
    contactPersonId: contactId, locationId, roles,
  });
  res.status(201).json(assignment);
}));

/**
 * PATCH /api/customer-companies/:companyId/assignments/:assignmentId
 * Update assignment roles for a contact at a specific location.
 */
const updateAssignmentSchema = z.object({
  roles: z.array(z.string()).default([]),
}).strict();

router.patch("/:companyId/assignments/:assignmentId", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId } = req;
  const { assignmentId } = req.params;

  const data = validateSchema(updateAssignmentSchema, req.body);
  const updated = await clientContactRepository.updateAssignment(tenantCompanyId!, assignmentId, { roles: data.roles ?? [] });
  if (!updated) throw createError(404, "Assignment not found");

  res.json(updated);
}));

/**
 * DELETE /api/customer-companies/:companyId/assignments/:assignmentId
 * Remove a contact assignment (unassign from location). Does NOT delete the person.
 */
router.delete("/:companyId/assignments/:assignmentId", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId } = req;
  const { assignmentId } = req.params;

  const deleted = await clientContactRepository.deleteAssignment(tenantCompanyId!, assignmentId);
  if (!deleted) throw createError(404, "Assignment not found");

  res.json({ success: true });
}));

// ============================================================================
// Deletion — eligibility check, hard delete, soft delete/archive
// ============================================================================

/**
 * GET /api/customer-companies/:companyId/delete-check
 * Returns eligibility info for deleting a customer company.
 */
router.get("/:companyId/delete-check", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId } = req;
  const { companyId: customerCompanyId } = req.params;

  const result = await customerCompanyRepository.checkCompanyDeleteEligibility(
    tenantCompanyId!,
    customerCompanyId
  );

  res.json(result);
}));

/**
 * DELETE /api/customer-companies/:companyId
 * Hard-delete a customer company (only if no operational history exists).
 * Requires typed confirmation: body.confirm === "DELETE"
 */
router.delete("/:companyId", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId } = req;
  const { companyId: customerCompanyId } = req.params;

  const confirmSchema = z.object({ confirm: z.literal("DELETE") }).strict();
  validateSchema(confirmSchema, req.body);

  // Re-check eligibility at delete time (race condition safety)
  const eligibility = await customerCompanyRepository.checkCompanyDeleteEligibility(
    tenantCompanyId!,
    customerCompanyId
  );

  if (!eligibility.canHardDelete) {
    throw createError(409, `Cannot hard-delete: ${eligibility.reasons.join(", ")}. Archive instead.`);
  }

  const deleted = await customerCompanyRepository.hardDeleteCustomerCompany(
    tenantCompanyId!,
    customerCompanyId
  );

  if (!deleted) throw createError(404, "Customer company not found");

  res.json({ success: true, action: "hard_delete" });
}));

/**
 * POST /api/customer-companies/:companyId/archive
 * Soft-delete (archive) a customer company and all its locations.
 */
router.post("/:companyId/archive", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId } = req;
  const { companyId: customerCompanyId } = req.params;

  const archived = await customerCompanyRepository.softDeleteCustomerCompany(
    tenantCompanyId!,
    customerCompanyId
  );

  if (!archived) throw createError(404, "Customer company not found");

  res.json({ success: true, action: "archived", company: archived });
}));

/**
 * POST /api/customer-companies/:companyId/restore
 * Restore a soft-deleted customer company and its locations.
 */
router.post("/:companyId/restore", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId } = req;
  const { companyId: customerCompanyId } = req.params;

  const restored = await customerCompanyRepository.restoreCustomerCompany(
    tenantCompanyId!,
    customerCompanyId
  );

  if (!restored) throw createError(404, "Customer company not found");

  res.json({ success: true, action: "restored", company: restored });
}));

// ============================================================================
// Location Linking (Orphan Management)
// ============================================================================

// Validation schema for link-location request
const linkLocationSchema = z.object({
  locationId: z.string().uuid("Invalid location ID"),
});

/**
 * POST /api/customer-companies/:companyId/link-location
 * Link an orphan location to a customer company
 *
 * Body: { locationId: string }
 *
 * This is for linking existing locations that have parentCompanyId = NULL
 * to a customer company. Both location and customer company must belong
 * to the same tenant.
 */
router.post("/:companyId/link-location", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId } = req;
  const { companyId: customerCompanyId } = req.params;

  if (!tenantCompanyId) {
    throw createError(401, "Missing company context");
  }

  const data = validateSchema(linkLocationSchema, req.body);

  const updatedLocation = await customerCompanyRepository.linkLocationToCustomerCompany(
    tenantCompanyId,
    data.locationId,
    customerCompanyId
  );

  res.json({
    success: true,
    location: updatedLocation,
    message: "Location linked successfully",
  });
}));

/**
 * GET /api/customer-companies/:companyId/unlinked-suggestions
 * Get orphan locations that might belong to this customer company
 * (locations with matching companyName but parentCompanyId = NULL)
 *
 * This helps users find locations that should be linked to this company.
 */
router.get("/:companyId/unlinked-suggestions", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId } = req;
  const { companyId: customerCompanyId } = req.params;

  if (!tenantCompanyId) {
    throw createError(401, "Missing company context");
  }

  // Get the customer company to find its name
  const customerCompany = await customerCompanyRepository.getCustomerCompany(
    tenantCompanyId,
    customerCompanyId
  );

  if (!customerCompany) {
    throw createError(404, "Customer company not found");
  }

  // Get all orphan locations for this tenant
  const allOrphans = await customerCompanyRepository.getOrphanLocations(tenantCompanyId);

  // Filter to locations that have this customer company as their suggested match
  // OR have matching companyName (case-insensitive)
  const suggestions = allOrphans.filter(orphan =>
    orphan.suggestedCustomerCompanyId === customerCompanyId ||
    (orphan.companyName ?? "").toLowerCase().trim() === (customerCompany.name ?? "").toLowerCase().trim()
  );

  res.json({
    suggestions,
    count: suggestions.length,
    customerCompany: {
      id: customerCompany.id,
      name: customerCompany.name,
    },
  });
}));

export default router;
