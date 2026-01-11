import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage/index";
import { insertClientSchema, clients, jobs, invoices, customerCompanies, insertLocationEquipmentSchema, updateLocationEquipmentSchema } from "@shared/schema";
import { z } from "zod";
import type { Client } from "@shared/schema";
import { db } from "../db";
import { eq, and, desc, inArray, isNotNull } from "drizzle-orm";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest } from "../auth/tenantIsolation";

const router = Router();

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

  const selectedMonth = client.selectedMonth;
  if (!selectedMonth) return "";
  const year = new Date().getFullYear();
  return formatDateOnly(new Date(year, selectedMonth - 1, 1));
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

// GET /api/clients - List all clients with pagination
router.get("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;

  // Parse pagination params from query
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 50;
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
  const assignmentLimit = clampInt(req.query.assignLimit as string | undefined, 5000, 1, 5000);

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

  res.json(client);
}));

// POST /api/clients/full-create - Create customer company + primary location + additional locations (Model A)
router.post("/full-create", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const userId = req.user.id;
  const { company, primaryLocation, additionalLocations = [] } = req.body;

  if (!company?.name?.trim()) {
    throw createError(400, "Company name is required");
  }

  // Check subscription limits (locations count)
  const limitCheck = await storage.canAddLocation(companyId!);
  if (!limitCheck.allowed) {
    throw createError(403, limitCheck.reason || "Subscription limit reached");
  }

  // Helper to calculate next due date (kept for back-compat)
  const calculateNextDue = (selectedMonths: number[]): string => {
    if (!selectedMonths || selectedMonths.length === 0) {
      return new Date("9999-12-31").toISOString();
    }
    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    const currentDay = today.getDate();
    const sorted = [...selectedMonths].sort((a, b) => a - b);

    if (sorted.includes(currentMonth) && currentDay < 15) {
      return new Date(currentYear, currentMonth, 15).toISOString();
    }
    let next = sorted.find((m) => m > currentMonth);
    if (next === undefined) {
      next = sorted[0];
      return new Date(currentYear + 1, next, 15).toISOString();
    }
    return new Date(currentYear, next, 15).toISOString();
  };

  // 1) Create (or reuse) customer company row
  // Reuse if same name exists for this tenant (prevents duplicates when users retry)
  const companyName = company.name.trim();
  const [existingCustomerCompany] = await db
    .select()
    .from(customerCompanies)
    .where(and(eq(customerCompanies.companyId, companyId), eq(customerCompanies.name, companyName)))
    .limit(1);

  const customerCompany =
    existingCustomerCompany ??
    (await db
      .insert(customerCompanies)
      .values({
        companyId,
        name: companyName,
        phone: company.phone?.trim() || null,
        email: company.email?.trim() || null,
        billingStreet: company.billingAddress?.street?.trim() || null,
        billingCity: company.billingAddress?.city?.trim() || null,
        billingProvince: company.billingAddress?.stateOrProvince?.trim() || null,
        billingPostalCode: company.billingAddress?.postalCode?.trim() || null,
        billingCountry: company.billingAddress?.country?.trim() || null,
      })
      .returning()
      .then((rows) => rows[0]));

  // 2) Create primary location (client record linked to customer company)
  const primaryLocationName = primaryLocation?.name?.trim() || companyName;
  const primarySelectedMonths = primaryLocation?.selectedMonths || [];

  const primaryClientData: any = {
    parentCompanyId: customerCompany.id,
    companyName,
    location: primaryLocationName,
    address: primaryLocation?.serviceAddress?.street?.trim() || null,
    city: primaryLocation?.serviceAddress?.city?.trim() || null,
    province: primaryLocation?.serviceAddress?.stateOrProvince?.trim() || null,
    postalCode: primaryLocation?.serviceAddress?.postalCode?.trim() || null,
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
      city: loc.serviceAddress?.city?.trim() || null,
      province: loc.serviceAddress?.stateOrProvince?.trim() || null,
      postalCode: loc.serviceAddress?.postalCode?.trim() || null,
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

  res.json({
    customerCompany,
    client: primaryClient,
    locations: createdLocations,
  });
}));

// POST /api/clients/quick-create - Quick create with minimal info (sets needsDetails=true)
router.post("/quick-create", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const userId = req.user.id;
  const { companyName } = req.body;

  if (!companyName?.trim()) {
    throw createError(400, "Company name is required");
  }

  // Check subscription limits
  const limitCheck = await storage.canAddLocation(companyId!);
  if (!limitCheck.allowed) {
    throw createError(403, limitCheck.reason || "Subscription limit reached");
  }

  // Create minimal client with needsDetails=true
  const clientData = {
    parentCompanyId: null,
    companyName: companyName.trim(),
    location: companyName.trim(),
    address: null,
    city: null,
    province: null,
    postalCode: null,
    contactName: null,
    email: null,
    phone: null,
    roofLadderCode: null,
    notes: null,
    selectedMonths: [],
    inactive: false,
    nextDue: new Date("9999-12-31").toISOString(),
    billWithParent: true,
    needsDetails: true,
  };

  const client = await storage.createClient(companyId, userId, clientData);

  res.json({ client });
}));

// POST /api/clients/import-simple - Simple import
router.post("/import-simple", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clients } = req.body;

  if (!Array.isArray(clients) || clients.length === 0) {
    throw createError(400, "Invalid import data: clients array is required");
  }

  // Request size validation - max 500 clients per import
  if (clients.length > 500) {
    throw createError(400, `Import limit exceeded: maximum 500 clients per request (received ${clients.length})`);
  }

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

  // Phase 1: Validate all clients upfront
  const validatedClients: any[] = [];
  const errors: string[] = [];

  for (const clientData of clients) {
    try {
      const validated = insertClientSchema.parse(clientData);
      validatedClients.push(validated);
    } catch (error) {
      errors.push(`Validation failed for ${clientData.companyName || 'unknown client'}`);
    }
  }

  // Phase 2: Bulk insert all valid clients (single INSERT statement)
  let imported = 0;
  if (validatedClients.length > 0) {
    try {
      const created = await storage.bulkCreateClients(req.companyId!, req.user!.id, validatedClients);
      imported = created.length;
    } catch (error: any) {
      errors.push(`Bulk insert failed: ${error.message || 'Unknown error'}`);
    }
  }

  res.json({
    imported,
    errors: errors.length > 0 ? errors : undefined,
    total: clients.length
  });
}));

// POST /api/clients/import - Full import with equipment and parts
router.post("/import", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clients: clientsToImport } = req.body;

  if (!Array.isArray(clientsToImport) || clientsToImport.length === 0) {
    throw createError(400, "Invalid import data: clients array is required");
  }

  // Request size validation - max 200 clients for full import (has nested parts/equipment)
  if (clientsToImport.length > 200) {
    throw createError(400, `Import limit exceeded: maximum 200 clients per full import (received ${clientsToImport.length}). Use /import-simple for larger batches.`);
  }

  let imported = 0;
  const errors: string[] = [];

  // Phase 1: Validate all clients upfront
  const validatedClients: Array<{
    clientInfo: any;
    parts: Array<{ name: string; quantity?: number }>;
    equipment: Array<{ name: string; modelNumber?: string; serialNumber?: string }>;
  }> = [];

  for (const clientData of clientsToImport) {
    try {
      const { parts, equipment, ...clientInfo } = clientData;
      const validated = insertClientSchema.parse(clientInfo);
      validatedClients.push({
        clientInfo: validated,
        parts: Array.isArray(parts) ? parts : [],
        equipment: Array.isArray(equipment) ? equipment : [],
      });
    } catch (error) {
      errors.push(`Validation failed for ${clientData.companyName || 'unknown client'}`);
    }
  }

  // Phase 2: Bulk create all clients (single INSERT)
  const createdClients: Array<{ client: any; parts: any[]; equipment: any[] }> = [];
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

  // Phase 4: Create equipment (collect all then bulk insert would be ideal, but sequential for now)
  for (const { client, equipment } of createdClients) {
    for (const equipData of equipment) {
      try {
        await storage.createEquipment(req.companyId!, req.user!.id, {
          clientId: client.id,
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
      const [parentCompany] = await db
        .select()
        .from(customerCompanies)
        .where(and(eq(customerCompanies.id, client.parentCompanyId), eq(customerCompanies.companyId, tenantCompanyId!)))
        .limit(1);

      if (parentCompany) {
        company = parentCompany;
        // Get all sibling locations - include both:
        // 1. Siblings with same parentCompanyId (newly linked children)
        // 2. Siblings with same companyName (legacy children and parent)
        const allLocationsWithSameName = await db
          .select()
          .from(clients)
          .where(and(
            eq(clients.companyId, tenantCompanyId!),
            eq(clients.companyName, client.companyName)
          ))
          .orderBy(desc(clients.createdAt)) as Client[];
        
        // Put the current client first, then other locations
        const currentClient = allLocationsWithSameName.find(loc => loc.id === client.id);
        const otherLocations = allLocationsWithSameName.filter(loc => loc.id !== client.id);
        locations = currentClient ? [currentClient, ...otherLocations] : allLocationsWithSameName;

        const locationIds = locations.map((l) => l.id).filter(Boolean);
        if (locationIds.length > 0) {
          jobsList = await db
            .select()
            .from(jobs)
            .where(and(eq(jobs.companyId, tenantCompanyId!), inArray(jobs.locationId, locationIds)))
            .orderBy(desc(jobs.createdAt))
            .limit(100);

          invoicesList = await db
            .select()
            .from(invoices)
            .where(and(eq(invoices.companyId, tenantCompanyId!), inArray(invoices.locationId, locationIds)))
            .orderBy(desc(invoices.createdAt))
            .limit(100);
        }
      }
    } else {
      // Legacy/standalone record (parentCompanyId is null).
      // Normalize to Model A: ensure a customerCompanies parent exists and link all same-name locations.
      const companyName = client.companyName;

      // Find or create the customer company for this tenant + name
      let [parentCompany] = await db
        .select()
        .from(customerCompanies)
        .where(and(
          eq(customerCompanies.companyId, tenantCompanyId!),
          eq(customerCompanies.name, companyName)
        ))
        .limit(1);

      if (!parentCompany) {
        [parentCompany] = await db
          .insert(customerCompanies)
          .values({
            companyId: tenantCompanyId!,
            name: companyName,
            phone: client.phone,
            email: client.email,
            billingStreet: client.address,
            billingCity: client.city,
            billingProvince: client.province,
            billingPostalCode: client.postalCode,
            billingCountry: null,
          })
          .returning();
      }

      company = parentCompany;

      // Link any tenant-owned clients with same companyName that are not yet linked
      const unlinkedSameName = await db
        .select({ id: clients.id, isPrimary: (clients as any).isPrimary, createdAt: clients.createdAt })
        .from(clients)
        .where(and(
          eq(clients.companyId, tenantCompanyId!),
          eq(clients.companyName, companyName),
          // only migrate rows that aren't already linked
          eq(clients.parentCompanyId, null as any)
        ));

      if (unlinkedSameName.length > 0) {
        // Determine a primary candidate (prefer existing isPrimary, else the current client, else oldest)
        const existingPrimary = unlinkedSameName.find((r) => (r as any).isPrimary === true);
        const currentRow = unlinkedSameName.find((r) => r.id === client.id);
        const oldest = [...unlinkedSameName].sort((a, b) => {
          const ta = a.createdAt ? new Date(a.createdAt as any).getTime() : 0;
          const tb = b.createdAt ? new Date(b.createdAt as any).getTime() : 0;
          return ta - tb;
        })[0];

        const primaryId = (existingPrimary?.id || currentRow?.id || oldest?.id) as string;

        // Link all and set isPrimary deterministically within this batch
        await db.transaction(async (tx) => {
          for (const row of unlinkedSameName) {
            await tx.update(clients)
              .set({
                parentCompanyId: parentCompany.id,
                isPrimary: row.id === primaryId,
              } as any)
              .where(and(
                eq(clients.id, row.id),
                eq(clients.companyId, tenantCompanyId!)
              ));
          }
        });

        // Refresh client reference if we just linked it
        if (client.id === primaryId) {
          (client as any).parentCompanyId = parentCompany.id;
          (client as any).isPrimary = true;
        }
      }

      // Now fetch all linked locations for this customer company
      locations = await db
        .select()
        .from(clients)
        .where(and(
          eq(clients.companyId, tenantCompanyId!),
          eq(clients.parentCompanyId, parentCompany.id)
        ))
        .orderBy(desc((clients as any).isPrimary), desc(clients.createdAt)) as Client[];

      const locationIds = locations.map((l) => l.id).filter(Boolean);
      if (locationIds.length > 0) {
        jobsList = await db
          .select()
          .from(jobs)
          .where(and(eq(jobs.companyId, tenantCompanyId!), inArray(jobs.locationId, locationIds)))
          .orderBy(desc(jobs.createdAt))
          .limit(100);

        invoicesList = await db
          .select()
          .from(invoices)
          .where(and(eq(invoices.companyId, tenantCompanyId!), inArray(invoices.locationId, locationIds)))
          .orderBy(desc(invoices.createdAt))
          .limit(100);
      }
    }

    const stats = {
      totalLocations: locations.length,
      openJobs: jobsList.filter((j: any) => j.status !== "completed" && j.status !== "cancelled").length,
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
    let [customerCompany] = await db
      .select()
      .from(customerCompanies)
      .where(and(eq(customerCompanies.id, idParam), eq(customerCompanies.companyId, tenantCompanyId)))
      .limit(1);

  // 2) Back-compat: if not found, treat param as a legacy client id and normalize to customerCompanies
  if (!customerCompany) {
    const legacyParentClient = await storage.getClient(tenantCompanyId, idParam);
    if (!legacyParentClient) {
      throw createError(404, "Company not found");
    }

      // Find or create a customer company by name
      const [existing] = await db
        .select()
        .from(customerCompanies)
        .where(and(
          eq(customerCompanies.companyId, tenantCompanyId),
          eq(customerCompanies.name, legacyParentClient.companyName)
        ))
        .limit(1);

      customerCompany =
        existing ??
        (await db
          .insert(customerCompanies)
          .values({
            companyId: tenantCompanyId,
            name: legacyParentClient.companyName,
            phone: legacyParentClient.phone,
            email: legacyParentClient.email,
            billingStreet: legacyParentClient.address,
            billingCity: legacyParentClient.city,
            billingProvince: legacyParentClient.province,
            billingPostalCode: legacyParentClient.postalCode,
            billingCountry: null,
          })
          .returning()
          .then((rows) => rows[0]));

      // Link all same-name unlinked locations under this customer company (Model A normalization)
      const sameNameUnlinked = await db
        .select({ id: clients.id, createdAt: clients.createdAt })
        .from(clients)
        .where(and(
          eq(clients.companyId, tenantCompanyId),
          eq(clients.companyName, legacyParentClient.companyName),
          eq(clients.parentCompanyId, null as any)
        ));

      if (sameNameUnlinked.length > 0) {
        const oldest = [...sameNameUnlinked].sort((a, b) => {
          const ta = a.createdAt ? new Date(a.createdAt as any).getTime() : 0;
          const tb = b.createdAt ? new Date(b.createdAt as any).getTime() : 0;
          return ta - tb;
        })[0];

        await db.transaction(async (tx) => {
          for (const row of sameNameUnlinked) {
            await tx.update(clients)
              .set({
                parentCompanyId: customerCompany!.id,
                isPrimary: row.id === oldest.id,
              } as any)
              .where(and(eq(clients.id, row.id), eq(clients.companyId, tenantCompanyId)));
          }
        });
      }
    }

    const { location, address, city, province, postalCode, contactName, phone, email } = req.body;

    const childLocationData: any = {
      parentCompanyId: customerCompany.id,
      companyName: customerCompany.name,
      location: location?.trim() || customerCompany.name,
      address: address?.trim() || null,
      city: city?.trim() || null,
      province: province?.trim() || null,
      postalCode: postalCode?.trim() || null,
      contactName: contactName?.trim() || null,
      phone: phone?.trim() || null,
      email: email?.trim() || null,
      inactive: false,
      nextDue: null,
      billWithParent: true,
      needsDetails: false,
      isPrimary: false,
    };

  const newLocation = await storage.createClient(tenantCompanyId, userId, childLocationData);

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
  await db.transaction(async (tx) => {
    // Clear isPrimary on all other locations with the same parentCompanyId AND companyId
    // This ensures cross-tenant isolation - parentCompanyId is unique within a tenant
    await tx.update(clients)
      .set({ isPrimary: false })
      .where(and(
        eq(clients.companyId, companyId),
        eq(clients.parentCompanyId, parentCompanyId)
      ));

    // Set this location as primary - double-check companyId for safety
    await tx.update(clients)
      .set({ isPrimary: true })
      .where(and(
        eq(clients.id, locationId),
        eq(clients.companyId, companyId)
      ));
  });

  // Fetch the updated location
  const updated = await storage.getClient(companyId, locationId);
  res.json(updated);
}));

// DELETE /api/clients/:id - Delete client
router.delete("/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  await storage.deleteAllClientParts(req.companyId, req.params.id);
  const deleted = await storage.deleteClient(req.companyId, req.params.id);
  if (!deleted) {
    throw createError(404, "Client not found");
  }
  res.json({ success: true });
}));

// POST /api/clients/bulk-delete - Bulk delete clients
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

export default router;