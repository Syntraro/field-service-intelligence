import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { storage, customerCompanyRepository, clientContactRepository } from "../storage/index";
import { insertClientSchema, insertLocationEquipmentSchema, updateLocationEquipmentSchema, postalCodeSchema } from "@shared/schema";
import { z } from "zod";
import type { Client } from "@shared/schema";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES, TECH_ROLES } from "../auth/roles";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest } from "../auth/tenantIsolation";
// Phase 1 Architecture: Event Log
import { logEventAsync } from "../lib/events";
import { getQueryCtx } from "../lib/queryCtx";
import { normalizePostalCode } from "../lib/addressNormalize";
import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { filesRepository } from "../storage/files";
import { extractNameplateFields } from "../services/nameplateOcr";
import { computeNextDueDate } from "@shared/nextDue";

const router = Router();

// ========================================
// PHASE A.1: STRICT IMPORT SCHEMAS
// Explicit allowlists for bulk import operations
// ========================================

/**
 * Schema for simple import request body - only accepts clients array
 */
const importSimpleRequestSchema = z.object({
  clients: z.array(insertClientSchema).min(1).max(500),
}).strict();

/**
 * Schema for equipment in full import
 */
const importEquipmentSchema = z.object({
  name: z.string().min(1).max(200),
  modelNumber: z.string().max(100).optional(),
  serialNumber: z.string().max(100).optional(),
}).strict();

/**
 * Schema for parts in full import
 */
const importPartSchema = z.object({
  name: z.string().min(1).max(200),
  quantity: z.number().int().positive().optional().default(1),
}).strict();

/**
 * Schema for a single client in full import (with nested parts/equipment)
 * Uses insertClientSchema for client fields (already omits id, companyId, userId, etc.)
 */
const importFullClientSchema = insertClientSchema.extend({
  parts: z.array(importPartSchema).optional().default([]),
  equipment: z.array(importEquipmentSchema).optional().default([]),
});

/**
 * Schema for full import request body
 */
const importFullRequestSchema = z.object({
  clients: z.array(importFullClientSchema).min(1).max(200),
}).strict();

// ========================================
// HELPER FUNCTIONS
// ========================================

function clampInt(raw: string | undefined, def: number, min: number, max: number) {
  const n = raw ? Number(raw) : def;
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function getISODateOrDefault(raw: string | undefined, dayOffset: number) {
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  return d.toISOString().slice(0, 10);
}

function formatDateOnly(d: Date): string {
  return d.toISOString().split("T")[0];
}

function deriveNextDueForClient(client: any, futureDueByClientId: Map<string, string>): string {
  const derived = futureDueByClientId.get(client.id);
  if (derived) return derived;

  // 2026-03-20 Phase 4D: Fixed — was using client.selectedMonth (singular, nonexistent field).
  // Now uses client.selectedMonths (plural, integer[]) with canonical shared formula.
  const nextDue = computeNextDueDate(client.selectedMonths ?? []);
  if (!nextDue) return "";
  return formatDateOnly(nextDue);
}

function buildFutureDueIndex(assignments: any[]): Map<string, string> {
  const now = new Date();
  const index = new Map<string, string>();

  for (const a of assignments || []) {
    if (!a?.clientId || !a?.date) continue;
    const d = new Date(a.date);
    if (isNaN(d.getTime())) continue;
    if (d < now) continue;

    const current = index.get(a.clientId);
    const fd = formatDateOnly(d);
    if (!current) index.set(a.clientId, fd);
    else {
      const curD = new Date(current);
      if (d < curD) index.set(a.clientId, fd);
    }
  }
  return index;
}

// ========================================
// ROUTES
// ========================================

/**
 * GET /api/clients/search-locations
 *
 * Server-backed location search for job creation dialogs.
 * Replaces the old "fetch all locations + filter client-side" pattern
 * that broke for tenants with >50 locations.
 *
 * Searches across: location companyName, parent company name, location name,
 * address, and city. Punctuation-insensitive (apostrophes stripped) so
 * "Moxie's", "Moxies", and "moxi" all match.
 *
 * Returns max 30 active, non-deleted locations with parent company name included.
 */
router.get("/search-locations", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  if (!companyId) {
    return res.status(401).json({ message: "Missing company context" });
  }

  const rawQuery = ((req.query.q as string) ?? "").trim();
  const limitParam = parseInt(req.query.limit as string, 10);
  const limit = Math.min(Math.max(limitParam || 30, 1), 50);

  // If no query, return most recent / alphabetical locations (initial load for empty search)
  // This lets the dropdown show options before the user types anything
  if (rawQuery.length === 0) {
    const { rows } = await (await import("../db")).pool.query(
      `SELECT cl.id, cl.company_name, cl.location, cl.address, cl.city,
              cl.parent_company_id, cl.needs_details,
              cc.name AS parent_company_name
       FROM client_locations cl
       LEFT JOIN customer_companies cc ON cl.parent_company_id = cc.id
       WHERE cl.company_id = $1
         AND cl.deleted_at IS NULL
         AND (cl.inactive = false OR cl.inactive IS NULL)
       ORDER BY cl.company_name ASC
       LIMIT $2`,
      [companyId, limit]
    );
    return res.json(rows);
  }

  if (rawQuery.length < 2) {
    return res.json([]);
  }

  // Normalize: strip apostrophes/smart quotes for punctuation-insensitive matching
  const normalized = rawQuery
    .replace(/[''`\u2018\u2019\u201B\u2032]/g, "")
    .replace(/[%_]/g, "\\$&"); // escape SQL LIKE wildcards

  const likePattern = `%${normalized}%`;

  // Characters to strip for punctuation-insensitive matching (apostrophes, smart quotes, backticks).
  // Passed as $5 parameter to avoid template-literal escaping issues with backticks.
  const stripChars = "'''`\u2018\u2019\u201B\u2032";

  // Single query: join customer_companies for parent name,
  // search across companyName, parent name, location, address, city
  // using translate() to strip apostrophes on the DB side too
  const { rows } = await (await import("../db")).pool.query(
    `SELECT cl.id, cl.company_name, cl.location, cl.address, cl.city,
            cl.parent_company_id, cl.needs_details,
            cc.name AS parent_company_name,
            -- Rank: 0=exact name, 1=prefix name, 2=parent match, 3=address/city
            CASE
              WHEN translate(lower(cl.company_name), $5, '') = lower($2) THEN 0
              WHEN translate(lower(cl.company_name), $5, '') LIKE lower($2) || '%' THEN 1
              WHEN translate(lower(COALESCE(cc.name, '')), $5, '') LIKE '%' || lower($2) || '%' THEN 2
              ELSE 3
            END AS match_rank
     FROM client_locations cl
     LEFT JOIN customer_companies cc ON cl.parent_company_id = cc.id
     WHERE cl.company_id = $1
       AND cl.deleted_at IS NULL
       AND (cl.inactive = false OR cl.inactive IS NULL)
       AND (
         translate(lower(cl.company_name), $5, '') ILIKE $3
         OR translate(lower(COALESCE(cc.name, '')), $5, '') ILIKE $3
         OR translate(lower(COALESCE(cl.location, '')), $5, '') ILIKE $3
         OR lower(COALESCE(cl.address, '')) ILIKE $3
         OR lower(COALESCE(cl.city, '')) ILIKE $3
       )
     ORDER BY match_rank ASC, cl.company_name ASC
     LIMIT $4`,
    [companyId, normalized, likePattern, limit, stripChars]
  );

  return res.json(rows);
}));

// GET /api/clients - List all clients with pagination
router.get("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
if (!companyId) {
  return res.status(401).json({ message: "Missing company context" });
}

  // Parse pagination params from query
  const page = clampInt(req.query.page as string | undefined, 1, 1, 10_000);
// Fix: raised max from 100 to 500 so client list can fetch all locations in one page
const limit = clampInt(req.query.limit as string | undefined, 50, 1, 500);


  const search = req.query.search as string;
  const sortBy = req.query.sortBy as 'companyName' | 'createdAt' | 'updatedAt' | undefined;
  const sortOrder = req.query.sortOrder as 'asc' | 'desc' | undefined;
  const inactive = req.query.inactive === 'true' ? true : req.query.inactive === 'false' ? false : undefined;

  // Get paginated clients
  const result = await storage.getPaginatedClients(companyId, {
    page,
    limit,
    search,
    sortBy,
    sortOrder,
    inactive,
  });

  // Get calendar assignments for nextDue calculation
  const start = getISODateOrDefault(req.query.assignStart as string | undefined, -30);
  const end = getISODateOrDefault(req.query.assignEnd as string | undefined, +60);
  const assignmentLimit = clampInt(req.query.assignLimit as string | undefined, 100, 1, 100);

  const assignments = await storage.getCalendarAssignmentsInRange(companyId, {
    start,
    end,
    limit: assignmentLimit,
  });

  const futureDueByClientId = buildFutureDueIndex(assignments);

  // Add nextDue to each client
  const clientsWithDue = result.data.map((c: any) => ({
    ...c,
    nextDue: deriveNextDueForClient(c, futureDueByClientId),
  }));

  // Return paginated response
  res.json({
    data: clientsWithDue,
    pagination: result.pagination,
  });
}));

// POST /api/clients - Create new client
router.post("/", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  // Check subscription limits
  const limitCheck = await storage.canAddLocation(req.companyId!);
  if (!limitCheck.allowed) {
    throw createError(403, limitCheck.reason || "Subscription limit reached");
  }

  const { parts, ...clientData } = req.body;
  const validated = validateSchema(insertClientSchema, clientData);

  let client: Client;

  // If parts are provided, use transactional method
  if (parts && Array.isArray(parts) && parts.length > 0) {
    const partsSchema = z.array(z.object({
      partId: z.string().uuid(),
      quantity: z.number().int().positive()
    }).strict());

    const validatedParts = validateSchema(partsSchema, parts);
    client = await storage.createClientWithParts(
      req.companyId,
      req.user.id,
      validated,
      validatedParts
    );
  } else {
    // No parts, use regular client creation
    client = await storage.createClient(req.companyId, req.user.id, validated);
  }

  // Phase 1: Log client creation event
  logEventAsync(getQueryCtx(req), {
    eventType: "client.created",
    entityType: "client",
    entityId: client.id,
    summary: `Created client ${client.companyName}`,
    meta: { companyName: client.companyName, location: client.location },
  });

  res.json(client);
}));

// POST /api/clients/full-create - Create customer company + primary location + additional locations (Model A)
router.post("/full-create", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const userId = req.user.id;
  const { company, primaryLocation, additionalLocations = [], contacts = [] } = req.body;

  if (!company?.name?.trim()) {
    throw createError(400, "Company name is required");
  }

  // Check subscription limits (locations count)
  const limitCheck = await storage.canAddLocation(companyId!);
  if (!limitCheck.allowed) {
    throw createError(403, limitCheck.reason || "Subscription limit reached");
  }

  // 2026-03-20 Phase 4C: Uses canonical shared formula; converts to ISO/sentinel at call site
  const calculateNextDue = (selectedMonths: number[]): string => {
    const date = computeNextDueDate(selectedMonths);
    return date ? date.toISOString() : new Date("9999-12-31").toISOString();
  };

  // 1) Create (or reuse) customer company row
  // Reuse if same name exists for this tenant (prevents duplicates when users retry)
  const companyName = company.name.trim();
  // nameSource: 'company' (default) = use company name as display, 'person' = use contact first+last
  const nameSource = company.nameSource === "person" ? "person" : "company";
  const customerCompany = await customerCompanyRepository.findOrCreateCustomerCompany(
    companyId,
    {
      name: companyName,
      phone: company.phone?.trim() || null,
      email: company.email?.trim() || null,
      billingStreet: company.billingAddress?.street?.trim() || null,
      billingStreet2: company.billingAddress?.street2?.trim() || null,
      billingCity: company.billingAddress?.city?.trim() || null,
      billingProvince: company.billingAddress?.stateOrProvince?.trim() || company.billingAddress?.province?.trim() || null,
      billingPostalCode: company.billingAddress?.postalCode?.trim() ? normalizePostalCode(company.billingAddress.postalCode.trim()) : null,
      billingCountry: company.billingAddress?.country?.trim() || null,
      nameSource,
    }
  );

  // 2) Create primary location (client record linked to customer company)
  const primaryLocationName = primaryLocation?.name?.trim() || companyName;
  const primarySelectedMonths = primaryLocation?.selectedMonths || [];

  const primaryClientData: any = {
    parentCompanyId: customerCompany.id,
    companyName,
    location: primaryLocationName,
    address: primaryLocation?.serviceAddress?.street?.trim() || null,
    address2: primaryLocation?.serviceAddress?.street2?.trim() || null,
    city: primaryLocation?.serviceAddress?.city?.trim() || null,
    province: primaryLocation?.serviceAddress?.stateOrProvince?.trim() || primaryLocation?.serviceAddress?.province?.trim() || null,
    postalCode: primaryLocation?.serviceAddress?.postalCode?.trim() ? normalizePostalCode(primaryLocation.serviceAddress.postalCode.trim()) : null,
    country: primaryLocation?.serviceAddress?.country?.trim() || null,
    lat: primaryLocation?.serviceAddress?.lat || null,
    lng: primaryLocation?.serviceAddress?.lng || null,
    placeId: primaryLocation?.serviceAddress?.placeId?.trim() || null,
    contactName: primaryLocation?.contactName?.trim() || null,
    email: primaryLocation?.contactEmail?.trim() || company.email?.trim() || null,
    phone: primaryLocation?.contactPhone?.trim() || company.phone?.trim() || null,
    roofLadderCode: null,
    notes: primaryLocation?.notes?.trim() || null,
    selectedMonths: primarySelectedMonths,
    inactive: false,
    nextDue: calculateNextDue(primarySelectedMonths),
    billWithParent: primaryLocation?.billWithParent !== false,
    needsDetails: primaryLocation?.needsDetails === true,
    // If schema supports it, mark primary explicitly
    isPrimary: true,
  };

  const primaryClient = await storage.createClient(companyId, userId, primaryClientData);

  // 3) Create additional locations (children of same customer company)
  const createdLocations: Client[] = [primaryClient];
  for (const loc of additionalLocations) {
    if (!loc?.name?.trim()) continue;

    const selectedMonths = loc.selectedMonths || [];
    const locData: any = {
      parentCompanyId: customerCompany.id,
      companyName,
      location: loc.name.trim(),
      address: loc.serviceAddress?.street?.trim() || null,
      address2: loc.serviceAddress?.street2?.trim() || null,
      city: loc.serviceAddress?.city?.trim() || null,
      province: loc.serviceAddress?.stateOrProvince?.trim() || loc.serviceAddress?.province?.trim() || null,
      postalCode: loc.serviceAddress?.postalCode?.trim() ? normalizePostalCode(loc.serviceAddress.postalCode.trim()) : null,
      country: loc.serviceAddress?.country?.trim() || null,
      lat: loc.serviceAddress?.lat || null,
      lng: loc.serviceAddress?.lng || null,
      placeId: loc.serviceAddress?.placeId?.trim() || null,
      contactName: loc.contactName?.trim() || null,
      email: loc.contactEmail?.trim() || company.email?.trim() || null,
      phone: loc.contactPhone?.trim() || company.phone?.trim() || null,
      roofLadderCode: null,
      notes: loc.notes?.trim() || null,
      selectedMonths,
      inactive: false,
      nextDue: calculateNextDue(selectedMonths),
      billWithParent: loc.billWithParent !== false,
      needsDetails: loc.needsDetails === true,
      isPrimary: false,
    };

    const newLoc = await storage.createClient(companyId, userId, locData);
    createdLocations.push(newLoc);
  }

  // 4) Create contacts (company-level and location-level)
  // contacts array format: [{ firstName, lastName, email, phone, roles, locationIndex?, isPrimary }]
  // locationIndex: undefined/null = company-level, 0 = primary location, 1+ = additional location index
  let createdContacts: any[] = [];
  if (contacts.length > 0) {
    const contactRows = contacts.map((c: any) => {
      let locationId: string | null = null;
      if (c.locationIndex != null && c.locationIndex >= 0) {
        // locationIndex 0 = primary, 1+ = additional locations (offset by 1 since createdLocations[0] = primary)
        const loc = createdLocations[c.locationIndex];
        if (loc) locationId = loc.id;
      }
      return {
        customerCompanyId: customerCompany.id,
        locationId,
        firstName: (c.firstName || "").trim(),
        lastName: (c.lastName || "").trim(),
        email: c.email?.trim() || null,
        phone: c.phone?.trim() || null,
        roles: Array.isArray(c.roles) ? c.roles : [],
        isPrimary: c.isPrimary === true,
      };
    });
    createdContacts = await clientContactRepository.createContacts(companyId, contactRows);
  }

  res.json({
    customerCompany,
    client: primaryClient,
    locations: createdLocations,
    contacts: createdContacts,
  });
}));

/**
 * POST /api/clients/quick-create
 * Quick create with minimal info (sets needsDetails=true)
 *
 * NOTE: This creates a STANDALONE location (parentCompanyId = null).
 * To create a location under an existing customer company, use:
 *   POST /api/customer-companies/:companyId/locations
 *
 * Orphan locations can later be linked using:
 *   POST /api/customer-companies/:companyId/link-location
 */
router.post("/quick-create", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const userId = req.user.id;

  // Phase 1 geocoding: Zod validation for quick-create (was previously unvalidated)
  // Phase 3: postalCodeSchema validates CA/US format and normalizes Canadian codes
  const quickCreateSchema = z.object({
    companyName: z.string().min(1, "Company name is required"),
    contactName: z.string().nullable().optional(),
    address: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    province: z.string().nullable().optional(),
    postalCode: postalCodeSchema,
    country: z.string().nullable().optional(),
    lat: z.string().nullable().optional(),
    lng: z.string().nullable().optional(),
    placeId: z.string().nullable().optional(),
  });
  const validated = validateSchema(quickCreateSchema, req.body);

  // Check subscription limits
  const limitCheck = await storage.canAddLocation(companyId!);
  if (!limitCheck.allowed) {
    throw createError(403, limitCheck.reason || "Subscription limit reached");
  }

  // Determine if address fields were provided (reduces needsDetails flag)
  const hasAddress = !!(validated.address?.trim() || validated.city?.trim());

  // Create client — sets needsDetails=true only when address is missing
  const clientData = {
    parentCompanyId: null,
    companyName: validated.companyName.trim(),
    location: validated.companyName.trim(),
    address: validated.address?.trim() || null,
    city: validated.city?.trim() || null,
    province: validated.province?.trim() || null,
    postalCode: validated.postalCode?.trim() || null,
    country: validated.country?.trim() || null,
    lat: validated.lat || null,
    lng: validated.lng || null,
    placeId: validated.placeId?.trim() || null,
    contactName: validated.contactName?.trim() || null,
    email: null,
    phone: null,
    roofLadderCode: null,
    notes: null,
    selectedMonths: [],
    inactive: false,
    nextDue: new Date("9999-12-31").toISOString(),
    billWithParent: true,
    needsDetails: !hasAddress,
  };

  const client = await storage.createClient(companyId, userId, clientData);

  // Phase 1: Log quick-create client event
  logEventAsync(getQueryCtx(req), {
    eventType: "client.created",
    entityType: "client",
    entityId: client.id,
    summary: `Created client ${client.companyName} (quick)`,
    meta: { companyName: client.companyName },
  });

  res.json({ client });
}));

/**
 * GET /api/clients/:clientId/contacts
 * Get contacts for a client location (and its parent customer company).
 * Returns both company-level contacts and location-specific contacts.
 */
router.get("/:clientId/contacts", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const { clientId } = req.params;

  const client = await storage.getClient(companyId!, clientId);
  if (!client) throw createError(404, "Client not found");

  // Get location-specific contacts
  const locationContacts = await clientContactRepository.getLocationContacts(companyId!, clientId);

  // Get company-level contacts if this location has a parent company
  let companyContacts: any[] = [];
  if (client.parentCompanyId) {
    companyContacts = await clientContactRepository.getCompanyContacts(companyId!, client.parentCompanyId);
  }

  res.json({ companyContacts, locationContacts });
}));

/**
 * POST /api/clients/import-simple - Simple bulk import
 * PHASE A.1: Uses strict schema to reject unknown/forbidden fields
 */
router.post("/import-simple", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  // PHASE A.1: Strict validation - rejects unknown keys at any level
  const validated = validateSchema(importSimpleRequestSchema, req.body);
  const clients = validated.clients;

  // Check if user can import this many clients
  const usage = await storage.getSubscriptionUsage(req.companyId!) as any;
  const availableSlots = usage.plan ? usage.plan.locationLimit - usage.usage.locations : 999999;

  const subscriptionsEnabled = process.env.ENABLE_SUBSCRIPTIONS === 'true';
  if (subscriptionsEnabled && clients.length > availableSlots) {
    const error: any = createError(403, `Cannot import ${clients.length} clients. You have ${availableSlots} available locations on your ${usage.plan?.displayName} plan.`);
    error.subscriptionLimitReached = true;
    error.current = usage.usage.locations;
    error.limit = usage.plan?.locationLimit || 0;
    error.requested = clients.length;
    throw error;
  }

  // Bulk insert all validated clients (single INSERT statement)
  const errors: string[] = [];
  let imported = 0;

  try {
    const created = await storage.bulkCreateClients(req.companyId!, req.user!.id, clients);
    imported = created.length;
  } catch (error: any) {
    errors.push(`Bulk insert failed: ${error.message || 'Unknown error'}`);
  }

  res.json({
    imported,
    errors: errors.length > 0 ? errors : undefined,
    total: clients.length
  });
}));

/**
 * POST /api/clients/import - Full import with equipment and parts
 * PHASE A.1: Uses strict schema to reject unknown/forbidden fields at all levels
 */
router.post("/import", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  // PHASE A.1: Strict validation - rejects unknown keys at any level
  const validated = validateSchema(importFullRequestSchema, req.body);
  const clientsToImport = validated.clients;

  let imported = 0;
  const errors: string[] = [];

  // Extract client info from validated data (parts/equipment already validated)
  const validatedClients = clientsToImport.map(c => {
    const { parts, equipment, ...clientInfo } = c;
    return {
      clientInfo,
      parts: parts || [],
      equipment: equipment || [],
    };
  });

  // Phase 2: Bulk create all clients (single INSERT)
  const createdClients: Array<{ client: any; parts: typeof validatedClients[0]['parts']; equipment: typeof validatedClients[0]['equipment'] }> = [];
  if (validatedClients.length > 0) {
    try {
      const clientInfos = validatedClients.map(v => v.clientInfo);
      const created = await storage.bulkCreateClients(req.companyId!, req.user!.id, clientInfos);
      imported = created.length;

      // Match created clients back to their parts/equipment
      for (let i = 0; i < created.length; i++) {
        createdClients.push({
          client: created[i],
          parts: validatedClients[i].parts,
          equipment: validatedClients[i].equipment,
        });
      }
    } catch (error: any) {
      errors.push(`Bulk client creation failed: ${error.message || 'Unknown error'}`);
    }
  }

  // Phase 3: Collect all parts to create (batch by unique name to avoid duplicates)
  const uniquePartNames = new Map<string, { name: string; quantity: number; clientIds: string[] }>();
  for (const { client, parts } of createdClients) {
    for (const partData of parts) {
      if (!partData.name) continue;
      const existing = uniquePartNames.get(partData.name);
      if (existing) {
        existing.clientIds.push(client.id);
      } else {
        uniquePartNames.set(partData.name, {
          name: partData.name,
          quantity: partData.quantity || 1,
          clientIds: [client.id],
        });
      }
    }
  }

  // Create parts and link to clients (reduced from N*M queries to N+M)
  const partIdByName = new Map<string, string>();
  for (const [name] of Array.from(uniquePartNames.entries())) {
    try {
      const part = await storage.createPart(req.companyId!, req.user!.id, {
        type: 'other',
        name,
        filterType: null,
        beltType: null,
        size: null,
        description: null,
      });
      partIdByName.set(name, part.id);
    } catch {
      // Part creation failed - skip linking this part
    }
  }

  // Collect all client-part links for bulk insert
  const clientPartLinks: Array<{ clientId: string; partId: string; quantity: number }> = [];
  for (const { client, parts } of createdClients) {
    for (const partData of parts) {
      const partId = partIdByName.get(partData.name);
      if (partId) {
        clientPartLinks.push({
          clientId: client.id,
          partId,
          quantity: partData.quantity || 1,
        });
      }
    }
  }

  // Bulk insert client-part links
  if (clientPartLinks.length > 0) {
    try {
      await storage.upsertClientPartsBulk(req.companyId!, req.user!.id, clientPartLinks);
    } catch {
      // Client-part linking failed - continue with equipment
    }
  }

  // Phase 6: Create equipment in canonical locationEquipment table
  for (const { client, equipment } of createdClients) {
    for (const equipData of equipment) {
      try {
        await storage.createLocationEquipment(req.companyId!, client.id, {
          name: equipData.name,
          modelNumber: equipData.modelNumber || null,
          serialNumber: equipData.serialNumber || null,
          notes: null,
        });
      } catch {
        // Equipment creation failed - continue with next
      }
    }
  }

  res.json({
    imported,
    errors: errors.length > 0 ? errors : undefined,
    total: clientsToImport.length
  });
}));

// GET /api/clients/:id/overview - Unified overview for any client (parent or child)
router.get("/:id/overview", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const tenantCompanyId = req.companyId;
  const clientId = req.params.id;

  // Fetch the clicked client
  const client = await storage.getClient(tenantCompanyId, clientId);
  if (!client) {
    throw createError(404, "Client not found");
  }

    let locations: Client[] = [];
    let jobsList: any[] = [];
    let invoicesList: any[] = [];
    let company: any = null;

    if (client.parentCompanyId) {
      // This is a child location - fetch via parent customer company
      const parentCompany = await customerCompanyRepository.getCustomerCompany(
        tenantCompanyId!,
        client.parentCompanyId
      );

      if (parentCompany) {
        company = parentCompany;
        // Fix: use parentCompanyId (relational FK) instead of companyName (case-sensitive string match)
        // Old approach used getLocationsByCompanyName which missed locations with variant casing
        // (e.g., CSV import creating "Basil HVAC" and "basil hvac" under the same parent)
        const allLinkedLocations = await customerCompanyRepository.getAllCustomerCompanyLocations(
          tenantCompanyId!,
          parentCompany.id
        );

        // Put the current client first, then other locations
        const currentClient = allLinkedLocations.find(loc => loc.id === client.id);
        const otherLocations = allLinkedLocations.filter(loc => loc.id !== client.id);
        locations = currentClient ? [currentClient, ...otherLocations] : allLinkedLocations;

        const locationIds = locations.map((l) => l.id).filter(Boolean);
        if (locationIds.length > 0) {
          const result = await customerCompanyRepository.getJobsAndInvoicesForLocations(
            tenantCompanyId!,
            locationIds,
            100
          );
          jobsList = result.jobs;
          invoicesList = result.invoices;
        }
      }
    } else {
      // Legacy/standalone record (parentCompanyId is null).
      // Normalize to Model A: ensure a customerCompanies parent exists and link all same-name locations.
      const companyName = client.companyName;

      // Find or create the customer company for this tenant + name
      const parentCompany = await customerCompanyRepository.findOrCreateCustomerCompany(
        tenantCompanyId!,
        {
          name: companyName,
          phone: client.phone,
          email: client.email,
          billingStreet: client.address,
          billingCity: client.city,
          billingProvince: client.province,
          billingPostalCode: client.postalCode,
          billingCountry: null,
        }
      );

      company = parentCompany;

      // Link any tenant-owned clients with same companyName that are not yet linked
      const unlinkedSameName = await customerCompanyRepository.getUnlinkedLocationsByCompanyName(
        tenantCompanyId!,
        companyName
      );

      if (unlinkedSameName.length > 0) {
        // Determine a primary candidate (prefer existing isPrimary, else the current client, else oldest)
        const existingPrimary = unlinkedSameName.find((r) => r.isPrimary === true);
        const currentRow = unlinkedSameName.find((r) => r.id === client.id);
        const oldest = [...unlinkedSameName].sort((a, b) => {
          const ta = a.createdAt ? new Date(a.createdAt as any).getTime() : 0;
          const tb = b.createdAt ? new Date(b.createdAt as any).getTime() : 0;
          return ta - tb;
        })[0];

        const primaryId = (existingPrimary?.id || currentRow?.id || oldest?.id) as string;

        // Link all and set isPrimary deterministically within this batch
        await customerCompanyRepository.linkLocationsToCustomerCompany(
          tenantCompanyId!,
          parentCompany.id,
          unlinkedSameName.map((row) => ({
            id: row.id,
            isPrimary: row.id === primaryId,
          }))
        );

        // Refresh client reference if we just linked it
        if (client.id === primaryId) {
          (client as any).parentCompanyId = parentCompany.id;
          (client as any).isPrimary = true;
        }
      }

      // Now fetch all linked locations for this customer company
      locations = await customerCompanyRepository.getAllCustomerCompanyLocations(
        tenantCompanyId!,
        parentCompany.id
      );

      const locationIds = locations.map((l) => l.id).filter(Boolean);
      if (locationIds.length > 0) {
        const result = await customerCompanyRepository.getJobsAndInvoicesForLocations(
          tenantCompanyId!,
          locationIds,
          100
        );
        jobsList = result.jobs;
        invoicesList = result.invoices;
      }
    }

    // Using normalized 4-status model: open, completed, invoiced, archived
    // Only "open" status jobs count as active
    const stats = {
      totalLocations: locations.length,
      openJobs: jobsList.filter((j: any) => j.status === "open").length,
      openInvoices: invoicesList.filter((i: any) => i.status !== "paid" && i.status !== "void").length,
    };

  res.json({
    company,
    locations,
    jobs: jobsList,
    invoices: invoicesList,
    stats,
  });
}));

// POST /api/clients/:companyId/locations - Create a child location under a parent client
router.post("/:companyId/locations", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const tenantCompanyId = req.companyId;
  const userId = req.user.id;
  const idParam = req.params.companyId; // customerCompanyId (preferred) OR legacy parent client id

  // Check subscription limits
  const limitCheck = await storage.canAddLocation(tenantCompanyId!) as any;
  if (!limitCheck.allowed) {
    const error: any = createError(403, limitCheck.reason || "Subscription limit reached");
    error.code = "SUBSCRIPTION_LIMIT";
    error.currentCount = limitCheck.currentCount;
    error.limit = limitCheck.limit;
    throw error;
  }

    // 1) Preferred: treat param as customerCompanies.id
    let customerCompany = await customerCompanyRepository.getCustomerCompany(
      tenantCompanyId,
      idParam
    );

  // 2) Back-compat: if not found, treat param as a legacy client id and normalize to customerCompanies
  if (!customerCompany) {
    const legacyParentClient = await storage.getClient(tenantCompanyId, idParam);
    if (!legacyParentClient) {
      throw createError(404, "Company not found");
    }

    // Find or create a customer company by name
    customerCompany = await customerCompanyRepository.findOrCreateCustomerCompany(
      tenantCompanyId,
      {
        name: legacyParentClient.companyName,
        phone: legacyParentClient.phone,
        email: legacyParentClient.email,
        billingStreet: legacyParentClient.address,
        billingCity: legacyParentClient.city,
        billingProvince: legacyParentClient.province,
        billingPostalCode: legacyParentClient.postalCode,
        billingCountry: null,
      }
    );

    // Link all same-name unlinked locations under this customer company (Model A normalization)
    const sameNameUnlinked = await customerCompanyRepository.getUnlinkedLocationsByCompanyName(
      tenantCompanyId,
      legacyParentClient.companyName
    );

    if (sameNameUnlinked.length > 0) {
      const oldest = [...sameNameUnlinked].sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt as any).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt as any).getTime() : 0;
        return ta - tb;
      })[0];

      await customerCompanyRepository.linkLocationsToCustomerCompany(
        tenantCompanyId,
        customerCompany.id,
        sameNameUnlinked.map((row) => ({
          id: row.id,
          isPrimary: row.id === oldest.id,
        }))
      );
    }
  }

  const { location, address, city, province, provinceState, stateOrProvince, postalCode, contactName, phone, email } = req.body;
  // Phase 3: resolve province from any variant + normalize postal
  const resolvedProvince = (province || provinceState || stateOrProvince || "")?.trim() || null;
  const resolvedPostal = postalCode?.trim() ? normalizePostalCode(postalCode.trim()) : null;

  const newLocation = await customerCompanyRepository.createLocationUnderCustomerCompany(
    tenantCompanyId,
    userId,
    customerCompany.id,
    {
      location: location?.trim() || customerCompany.name,
      address: address?.trim() || null,
      city: city?.trim() || null,
      province: resolvedProvince,
      postalCode: resolvedPostal,
      contactName: contactName?.trim() || null,
      phone: phone?.trim() || null,
      email: email?.trim() || null,
      billWithParent: true,
      inactive: false,
    }
  );

  res.json({ customerCompany, location: newLocation });
}));
// GET /api/clients/:id - Get single client
router.get("/:id", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const client = await storage.getClient(companyId, req.params.id);
  if (!client) {
    throw createError(404, "Client not found");
  }

  const assignments = await storage.getAssignmentsByClient(companyId, client.id);
  const futureDueByClientId = buildFutureDueIndex(assignments);
  const clientWithDue = {
    ...client,
    nextDue: deriveNextDueForClient(client, futureDueByClientId),
  };

  res.json(clientWithDue);
}));

// GET /api/clients/:id/report - Get client report
router.get("/:id/report", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const clientId = req.params.id;

  const report = await storage.getClientReport(companyId, clientId);
  if (!report) {
    throw createError(404, "Client not found");
  }

  res.json(report);
}));

// PUT /api/clients/:id - Update client with optimistic locking
router.put("/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { version, ...data } = req.body;
  // Phase 3: normalize postal code before validation
  if (typeof data.postalCode === "string" && data.postalCode.trim()) {
    data.postalCode = normalizePostalCode(data.postalCode.trim());
  }
  const validated = insertClientSchema.partial().parse(data);
  const companyId = req.companyId;
  const clientId = req.params.id;

  // Check if selectedMonths is being updated
  const isUpdatingPmMonths = validated.selectedMonths !== undefined;

  try {
    // Update the client with version check
    const client = await storage.updateClient(companyId, clientId, version, validated);
    if (!client) {
      throw createError(404, "Client not found");
    }

    // If PM months were updated, cleanup invalid calendar assignments
    let cleanupResult = { removedCount: 0 };
    if (isUpdatingPmMonths && client.selectedMonths) {
      cleanupResult = await storage.cleanupInvalidCalendarAssignments(
        companyId,
        clientId,
        client.selectedMonths
      );
    }

    res.json({
      ...client,
      _cleanupInfo: cleanupResult
    });
  } catch (error: any) {
    // Check for version mismatch
    if (error.message?.includes('modified by another user')) {
      return res.status(409).json({
        error: error.message,
        code: 'VERSION_MISMATCH'
      });
    }
    throw error;
  }
}));

// PATCH /api/clients/:id - Partial update with optimistic locking
router.patch("/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { version, ...data } = req.body;
  // Phase 3: normalize postal code before validation
  if (typeof data.postalCode === "string" && data.postalCode.trim()) {
    data.postalCode = normalizePostalCode(data.postalCode.trim());
  }
  const validated = insertClientSchema.partial().parse(data);
  const companyId = req.companyId;
  const clientId = req.params.id;

  try {
    const client = await storage.updateClient(companyId, clientId, version, validated);
    if (!client) {
      throw createError(404, "Client not found");
    }

    res.json(client);
  } catch (error: any) {
    // Check for version mismatch
    if (error.message?.includes('modified by another user')) {
      return res.status(409).json({
        error: error.message,
        code: 'VERSION_MISMATCH'
      });
    }
    throw error;
  }
}));

// POST /api/clients/:id/set-primary - Set location as primary for its parent company
router.post("/:id/set-primary", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const locationId = req.params.id;

  // Get the location first - this already enforces companyId scoping
  const location = await storage.getClient(companyId, locationId);
  if (!location) {
    throw createError(404, "Location not found");
  }

  if (!location.parentCompanyId) {
    throw createError(400, "Cannot set standalone client as primary");
  }

  // Store parentCompanyId to use in transaction (TypeScript narrows it to non-null here)
  const parentCompanyId = location.parentCompanyId;

  // Use a transaction to ensure atomicity
  await customerCompanyRepository.setLocationAsPrimary(
    companyId,
    parentCompanyId,
    locationId
  );

  // Fetch the updated location
  const updated = await storage.getClient(companyId, locationId);
  res.json(updated);
}));

// GET /api/clients/:id/delete-check - Check location delete eligibility
router.get("/:id/delete-check", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const result = await customerCompanyRepository.checkLocationDeleteEligibility(
    req.companyId!,
    req.params.id
  );
  res.json(result);
}));

// DELETE /api/clients/:id - Delete location (hard if eligible + confirm=DELETE, else soft-delete)
router.delete("/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const locationId = req.params.id;

  // If body has confirm=DELETE, attempt hard delete
  if (req.body?.confirm === "DELETE") {
    const eligibility = await customerCompanyRepository.checkLocationDeleteEligibility(companyId, locationId);

    if (!eligibility.canHardDelete) {
      throw createError(409, `Cannot hard-delete: ${eligibility.reasons.join(", ")}. Archive instead.`);
    }
    if (eligibility.isLastLocation) {
      throw createError(409, "Cannot delete the only location. Delete the company instead.");
    }

    const deleted = await customerCompanyRepository.hardDeleteLocation(companyId, locationId);
    if (!deleted) throw createError(404, "Location not found");

    return res.json({ success: true, action: "hard_delete" });
  }

  // Default: soft-delete (backward compatible)
  await storage.deleteAllClientParts(companyId, locationId);
  const deleted = await storage.deleteClient(companyId, locationId);
  if (!deleted) {
    throw createError(404, "Client not found");
  }
  res.json({ success: true, action: "soft_delete" });
}));

// POST /api/clients/bulk-delete - Bulk delete clients (soft delete)
router.post("/bulk-delete", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const schema = z.object({
    ids: z.array(z.string().uuid()).min(1).max(200)
  }).strict();

  const { ids } = validateSchema(schema, req.body);

  const result = await storage.deleteClients(req.companyId, ids);

  res.json({
    deletedIds: result.deletedIds,
    notFoundIds: result.notFoundIds,
    deletedCount: result.deletedIds.length,
    notFoundCount: result.notFoundIds.length
  });
}));

// ========================================
// LOCATION EQUIPMENT ROUTES
// ========================================

// GET /api/clients/:locationId/equipment - List location equipment
router.get("/:locationId/equipment", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const { locationId } = req.params;

  const location = await storage.getClient(companyId, locationId);
  if (!location) {
    throw createError(404, "Location not found");
  }

  const equipment = await storage.getLocationEquipment(companyId, locationId);
  res.json(equipment);
}));

// POST /api/clients/:locationId/equipment - Create location equipment
router.post("/:locationId/equipment", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const { locationId } = req.params;

  const location = await storage.getClient(companyId, locationId);
  if (!location) {
    throw createError(404, "Location not found");
  }

  const createSchema = insertLocationEquipmentSchema.omit({ companyId: true, locationId: true });
  const data = validateSchema(createSchema, req.body);

  const created = await storage.createLocationEquipment(companyId, locationId, data);
  res.status(201).json(created);
}));

// PATCH /api/clients/:locationId/equipment/:equipmentId - Update location equipment
router.patch("/:locationId/equipment/:equipmentId", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const { locationId, equipmentId } = req.params;

  const location = await storage.getClient(companyId, locationId);
  if (!location) {
    throw createError(404, "Location not found");
  }

  const existing = await storage.getLocationEquipmentById(companyId, equipmentId);
  if (!existing || existing.locationId !== locationId) {
    throw createError(404, "Equipment not found");
  }

  const data = validateSchema(updateLocationEquipmentSchema, req.body);
  const updated = await storage.updateLocationEquipment(companyId, equipmentId, data);
  res.json(updated);
}));

// DELETE /api/clients/:locationId/equipment/:equipmentId - Delete location equipment
router.delete("/:locationId/equipment/:equipmentId", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const { locationId, equipmentId } = req.params;

  const location = await storage.getClient(companyId, locationId);
  if (!location) {
    throw createError(404, "Location not found");
  }

  const existing = await storage.getLocationEquipmentById(companyId, equipmentId);
  if (!existing || existing.locationId !== locationId) {
    throw createError(404, "Equipment not found");
  }

  await storage.deleteLocationEquipment(companyId, equipmentId);
  res.json({ success: true });
}));

// =========================================================================
// Equipment Nameplate Photo + OCR (2026-03-06)
// Upload a nameplate image, persist it to files table, attempt OCR extraction.
// Photo is always saved; OCR is best-effort convenience.
// =========================================================================

const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");

const nameplateStorage = multer.diskStorage({
  destination(req, _file, cb) {
    const companyId = (req as AuthedRequest).companyId;
    const dir = path.join(UPLOADS_ROOT, companyId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(_req, file, cb) {
    const fileId = randomUUID();
    const ext = path.extname(file.originalname);
    (file as any)._fileId = fileId;
    cb(null, `${fileId}${ext}`);
  },
});

const nameplateUpload = multer({
  storage: nameplateStorage,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, cb) {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are accepted"));
    }
  },
});

/**
 * POST /api/clients/:locationId/equipment/:equipmentId/nameplate
 * Upload a nameplate photo, save to files table + link to equipment,
 * then attempt OCR extraction. Returns file info + OCR results.
 */
router.post(
  "/:locationId/equipment/:equipmentId/nameplate",
  requireRole(TECH_ROLES), // Techs can capture nameplates in the field
  nameplateUpload.single("photo"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { locationId, equipmentId } = req.params;
    const file = req.file as Express.Multer.File | undefined;

    if (!file) {
      throw createError(400, "No photo uploaded");
    }

    // Validate ownership
    const location = await storage.getClient(companyId, locationId);
    if (!location) throw createError(404, "Location not found");

    const equipment = await storage.getLocationEquipmentById(companyId, equipmentId);
    if (!equipment || equipment.locationId !== locationId) {
      throw createError(404, "Equipment not found");
    }

    // Persist file record
    const fileId = (file as any)._fileId as string;
    const storageKey = path.relative(process.cwd(), file.path);
    const fileRow = await filesRepository.createFile(companyId, req.user!.id, {
      storageKey,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    });

    // Link photo to equipment
    await storage.updateLocationEquipment(companyId, equipmentId, {
      nameplatePhotoId: fileRow.id,
    });

    // Attempt OCR (fire-and-await, but never blocks on failure)
    let ocr = { success: false } as Awaited<ReturnType<typeof extractNameplateFields>>;
    try {
      ocr = await extractNameplateFields(storageKey, file.mimetype);
    } catch {
      // OCR failure is non-blocking
    }

    res.status(201).json({
      file: {
        fileId: fileRow.id,
        originalName: fileRow.originalName,
        mimeType: fileRow.mimeType,
        size: fileRow.size,
        downloadUrl: `/api/files/${fileRow.id}`,
      },
      ocr,
    });
  })
);

/**
 * DELETE /api/clients/:locationId/equipment/:equipmentId/nameplate
 * Remove nameplate photo link from equipment (photo file remains in storage).
 */
router.delete(
  "/:locationId/equipment/:equipmentId/nameplate",
  requireRole(TECH_ROLES), // Techs can manage nameplate photos

  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { locationId, equipmentId } = req.params;

    const location = await storage.getClient(companyId, locationId);
    if (!location) throw createError(404, "Location not found");

    const equipment = await storage.getLocationEquipmentById(companyId, equipmentId);
    if (!equipment || equipment.locationId !== locationId) {
      throw createError(404, "Equipment not found");
    }

    await storage.updateLocationEquipment(companyId, equipmentId, {
      nameplatePhotoId: null,
    });

    res.json({ success: true });
  })
);

export default router;