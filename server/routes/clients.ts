import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage/index";
import { insertClientSchema, clients, jobs, invoices, customerCompanies } from "@shared/schema";
import { z } from "zod";
import type { Client } from "@shared/schema";
import { db } from "../db";
import { eq, and, desc, inArray, isNotNull } from "drizzle-orm";

const router = Router();

// ========================================
// HELPER FUNCTIONS
// ========================================

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
router.get("/", async (req, res) => {
  try {
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
    const assignments = await storage.getAllCalendarAssignments(companyId);
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
  } catch (error) {
    console.error('Error fetching clients:', error);
    res.status(500).json({ error: "Failed to fetch clients" });
  }
});

// POST /api/clients - Create new client
router.post("/", async (req, res) => {
  try {
    // Check subscription limits
    const limitCheck = await storage.canAddLocation(req.companyId);
    if (!limitCheck.allowed) {
      return res.status(403).json({ 
        error: limitCheck.reason,
        current: limitCheck.current,
        limit: limitCheck.limit,
        subscriptionLimitReached: true
      });
    }

    const { parts, ...clientData } = req.body;
    const validated = insertClientSchema.parse(clientData);

    let client: Client;

    // If parts are provided, use transactional method
    if (parts && Array.isArray(parts) && parts.length > 0) {
      const partsSchema = z.array(z.object({
        partId: z.string().uuid(),
        quantity: z.number().int().positive()
      }));

      const validatedParts = partsSchema.parse(parts);
      client = await storage.createClientWithParts(
        req.companyId, 
        req.user!.id, 
        validated, 
        validatedParts
      );
    } else {
      // No parts, use regular client creation
      client = await storage.createClient(req.companyId, req.user!.id, validated);
    }

    res.json(client);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid client or parts data", details: error.errors });
    }
    res.status(400).json({ error: "Invalid client data" });
  }
});

// POST /api/clients/full-create - Create customer company + primary location + additional locations (Model A)
router.post("/full-create", async (req, res) => {
  try {
    const companyId = req.companyId;
    const userId = req.user!.id;
    const { company, primaryLocation, additionalLocations = [] } = req.body;

    if (!companyId) return res.status(401).json({ error: "Unauthorized" });

    if (!company?.name?.trim()) {
      return res.status(400).json({ error: "Company name is required" });
    }

    // Check subscription limits (locations count)
    const limitCheck = await storage.canAddLocation(companyId);
    if (!limitCheck.allowed) {
      return res.status(403).json({
        error: limitCheck.reason,
        current: limitCheck.current,
        limit: limitCheck.limit,
        subscriptionLimitReached: true,
      });
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
  } catch (error) {
    console.error("Full create error:", error);
    res.status(500).json({ error: "Failed to create company and locations" });
  }
});

// POST /api/clients/quick-create - Quick create with minimal info (sets needsDetails=true)
router.post("/quick-create", async (req, res) => {
  try {
    const companyId = req.companyId;
    const userId = req.user!.id;
    const { companyName } = req.body;

    if (!companyName?.trim()) {
      return res.status(400).json({ error: "Company name is required" });
    }

    // Check subscription limits
    const limitCheck = await storage.canAddLocation(companyId);
    if (!limitCheck.allowed) {
      return res.status(403).json({
        error: limitCheck.reason,
        current: limitCheck.current,
        limit: limitCheck.limit,
        subscriptionLimitReached: true,
      });
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

    const client = await storage.createClient(companyId!, userId, clientData);

    res.json({ client });
  } catch (error) {
    console.error("Quick create error:", error);
    res.status(500).json({ error: "Failed to create client" });
  }
});

// POST /api/clients/import-simple - Simple import
router.post("/import-simple", async (req, res) => {
  try {
    const { clients } = req.body;

    if (!Array.isArray(clients) || clients.length === 0) {
      return res.status(400).json({ error: "Invalid import data: clients array is required" });
    }

    // Check if user can import this many clients
    const usage = await storage.getSubscriptionUsage(req.companyId);
    const availableSlots = usage.plan ? usage.plan.locationLimit - usage.usage.locations : 999999;

    const subscriptionsEnabled = process.env.ENABLE_SUBSCRIPTIONS === 'true';
    if (subscriptionsEnabled && clients.length > availableSlots) {
      return res.status(403).json({ 
        error: `Cannot import ${clients.length} clients. You have ${availableSlots} available locations on your ${usage.plan?.displayName} plan.`,
        subscriptionLimitReached: true,
        current: usage.usage.locations,
        limit: usage.plan?.locationLimit || 0,
        requested: clients.length
      });
    }

    let imported = 0;
    const errors: string[] = [];

    for (const clientData of clients) {
      try {
        const validated = insertClientSchema.parse(clientData);
        await storage.createClient(req.companyId, req.user!.id, validated);
        imported++;
      } catch (error) {
        errors.push(`Failed to import ${clientData.companyName || 'unknown client'}`);
      }
    }

    res.json({ 
      imported, 
      errors: errors.length > 0 ? errors : undefined,
      total: clients.length 
    });
  } catch (error) {
    console.error('Simple import error:', error);
    res.status(500).json({ error: "Failed to import clients" });
  }
});

// POST /api/clients/import - Full import with equipment and parts
router.post("/import", async (req, res) => {
  try {
    const { clients } = req.body;

    if (!Array.isArray(clients) || clients.length === 0) {
      return res.status(400).json({ error: "Invalid import data: clients array is required" });
    }

    let imported = 0;
    const errors: string[] = [];

    for (const clientData of clients) {
      try {
        const { parts, equipment, ...clientInfo } = clientData;
        const validated = insertClientSchema.parse(clientInfo);
        const client = await storage.createClient(req.companyId, req.user!.id, validated);
        imported++;

        // Import parts if present
        if (parts && Array.isArray(parts) && parts.length > 0) {
          for (const partData of parts) {
            try {
              // Create part as "other" type with the name from backup
              const part = await storage.createPart(req.companyId, req.user!.id, {
                type: 'other',
                name: partData.name,
                filterType: null,
                beltType: null,
                size: null,
                description: null,
              });

              // Link part to client
              await storage.addClientPart(req.companyId, req.user!.id, {
                clientId: client.id,
                partId: part.id,
                quantity: partData.quantity || 1,
              });
            } catch (partError) {
              console.error(`Failed to import part for ${client.companyName}:`, partError);
            }
          }
        }

        // Import equipment if present
        if (equipment && Array.isArray(equipment) && equipment.length > 0) {
          for (const equipData of equipment) {
            try {
              await storage.createEquipment(req.companyId, req.user!.id, {
                clientId: client.id,
                name: equipData.name,
                modelNumber: equipData.modelNumber || null,
                serialNumber: equipData.serialNumber || null,
                notes: null,
              });
            } catch (equipError) {
              console.error(`Failed to import equipment for ${client.companyName}:`, equipError);
            }
          }
        }
      } catch (error) {
        console.error('Import client error:', error);
        errors.push(`Failed to import ${clientData.companyName || 'unknown client'}`);
      }
    }

    res.json({ 
      imported, 
      errors: errors.length > 0 ? errors : undefined,
      total: clients.length 
    });
  } catch (error) {
    console.error('Bulk import error:', error);
    res.status(500).json({ error: "Failed to import clients" });
  }
});

// GET /api/clients/:id/overview - Unified overview for any client (parent or child)
router.get("/:id/overview", async (req, res) => {
  try {
    const tenantCompanyId = req.companyId;
    const clientId = req.params.id;

    // Fetch the clicked client
    const client = await storage.getClient(tenantCompanyId, clientId);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
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
            .orderBy(desc(jobs.createdAt));

          invoicesList = await db
            .select()
            .from(invoices)
            .where(and(eq(invoices.companyId, tenantCompanyId!), inArray(invoices.locationId, locationIds)))
            .orderBy(desc(invoices.createdAt));
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
          .orderBy(desc(jobs.createdAt));

        invoicesList = await db
          .select()
          .from(invoices)
          .where(and(eq(invoices.companyId, tenantCompanyId!), inArray(invoices.locationId, locationIds)))
          .orderBy(desc(invoices.createdAt));
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
  } catch (error) {
    console.error("Failed to fetch client overview:", error);
    res.status(500).json({ error: "Failed to fetch client overview" });
  }
});

// POST /api/clients/:companyId/locations - Create a child location under a parent client
router.post("/:companyId/locations", async (req, res) => {
  try {
    const tenantCompanyId = req.companyId;
    const userId = (req.user as any)?.id;
    const idParam = req.params.companyId; // customerCompanyId (preferred) OR legacy parent client id

    if (!tenantCompanyId) return res.status(401).json({ error: "Unauthorized" });

    // Check subscription limits
    const limitCheck = await storage.canAddLocation(tenantCompanyId);
    if (!limitCheck.allowed) {
      return res.status(403).json({
        error: limitCheck.reason,
        code: "SUBSCRIPTION_LIMIT",
        currentCount: limitCheck.currentCount,
        limit: limitCheck.limit,
      });
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
        return res.status(404).json({ error: "Company not found" });
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
  } catch (error) {
    console.error("Failed to create child location:", error);
    res.status(500).json({ error: "Failed to create location" });
  }
});
 // Get single client
router.get("/:id", async (req, res) => {
  try {
    const companyId = req.companyId;
    const client = await storage.getClient(companyId, req.params.id);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    const assignments = await storage.getAssignmentsByClient(companyId, client.id);
    const futureDueByClientId = buildFutureDueIndex(assignments);
    const clientWithDue = {
      ...client,
      nextDue: deriveNextDueForClient(client, futureDueByClientId),
    };

    res.json(clientWithDue);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch client" });
  }
});

// GET /api/clients/:id/report - Get client report
router.get("/:id/report", async (req, res) => {
  try {
    const companyId = req.companyId;
    const clientId = req.params.id;
    console.log(`[Report] Fetching report for companyId: ${companyId}, clientId: ${clientId}`);

    const report = await storage.getClientReport(companyId, clientId);
    if (!report) {
      console.log(`[Report] Client not found - companyId: ${companyId}, clientId: ${clientId}`);
      return res.status(404).json({ error: "Client not found" });
    }

    console.log(`[Report] Successfully generated report for: ${report.client.companyName}`);
    res.json(report);
  } catch (error) {
    console.error('[Report] Error generating report:', error);
    res.status(500).json({ error: "Failed to generate client report" });
  }
});

// PUT /api/clients/:id - Update client with optimistic locking
router.put("/:id", async (req, res) => {
  try {
    const { version, ...data } = req.body;
    const validated = insertClientSchema.partial().parse(data);
    const companyId = req.companyId;
    const clientId = req.params.id;

    // Check if selectedMonths is being updated
    const isUpdatingPmMonths = validated.selectedMonths !== undefined;

    // Update the client with version check
    const client = await storage.updateClient(companyId, clientId, version, validated);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
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
    
    res.status(400).json({ error: "Invalid client data" });
  }
});

// PATCH /api/clients/:id - Partial update with optimistic locking
router.patch("/:id", async (req, res) => {
  try {
    const { version, ...data } = req.body;
    const validated = insertClientSchema.partial().parse(data);
    const companyId = req.companyId;
    const clientId = req.params.id;

    const client = await storage.updateClient(companyId, clientId, version, validated);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
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
    
    res.status(400).json({ error: "Invalid client data" });
  }
});

// POST /api/clients/:id/set-primary - Set location as primary for its parent company
router.post("/:id/set-primary", async (req, res) => {
  try {
    const companyId = req.companyId;
    const locationId = req.params.id;

    if (!companyId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Get the location first - this already enforces companyId scoping
    const location = await storage.getClient(companyId, locationId);
    if (!location) {
      return res.status(404).json({ error: "Location not found" });
    }

    if (!location.parentCompanyId) {
      return res.status(400).json({ error: "Cannot set standalone client as primary" });
    }

    // Use a transaction to ensure atomicity
    await db.transaction(async (tx) => {
      // Clear isPrimary on all other locations with the same parentCompanyId AND companyId
      // This ensures cross-tenant isolation - parentCompanyId is unique within a tenant
      await tx.update(clients)
        .set({ isPrimary: false })
        .where(and(
          eq(clients.companyId, companyId),
          eq(clients.parentCompanyId, location.parentCompanyId)
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
  } catch (error) {
    console.error("Set primary error:", error);
    res.status(500).json({ error: "Failed to set primary location" });
  }
});

// DELETE /api/clients/:id - Delete client
router.delete("/:id", async (req, res) => {
  try {
    await storage.deleteAllClientParts(req.companyId, req.params.id);
    const deleted = await storage.deleteClient(req.companyId, req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: "Client not found" });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete client" });
  }
});

// POST /api/clients/bulk-delete - Bulk delete clients
router.post("/bulk-delete", async (req, res) => {
  try {
    const schema = z.object({
      ids: z.array(z.string().uuid()).min(1).max(200)
    });
    const { ids } = schema.parse(req.body);

    const result = await storage.deleteClients(req.companyId, ids);

    res.json({
      deletedIds: result.deletedIds,
      notFoundIds: result.notFoundIds,
      deletedCount: result.deletedIds.length,
      notFoundCount: result.notFoundIds.length
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request: must provide 1-200 client IDs" });
    }
    res.status(500).json({ error: "Failed to delete clients" });
  }
});

export default router;