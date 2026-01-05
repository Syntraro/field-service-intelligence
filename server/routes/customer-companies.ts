import { Router, Request, Response, NextFunction } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import db from "../db";
import { customerCompanies, clients, jobs, invoices } from "@shared/schema";
import { requireRole } from "../auth/requireRole";

const MANAGER_ROLES = ["owner", "admin", "manager", "dispatcher"];

type AuthedRequest = Request & {
  user?: { id: string } | undefined;
  companyId?: string | undefined;
};

function requireCompanyContext(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  if (!req.companyId) return res.status(400).json({ error: "Missing company context" });
  next();
}

const router = Router();
router.use(requireCompanyContext);

/**
 * GET /api/customer-companies/:companyId
 * Returns the customer company record for the current tenant (companyId context).
 */
router.get("/:companyId", async (req: AuthedRequest, res: Response) => {
  try {
    const { companyId: tenantCompanyId } = req;
    const { companyId } = req.params;

    const [company] = await db
      .select()
      .from(customerCompanies)
      .where(and(eq(customerCompanies.id, companyId), eq(customerCompanies.companyId, tenantCompanyId!)))
      .limit(1);

    if (!company) return res.status(404).json({ error: "Customer company not found" });
    res.json(company);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch customer company" });
  }
});

/**
 * GET /api/customer-companies/:companyId/locations
 * Returns locations (clients) belonging to the customer company.
 */
router.get("/:companyId/locations", async (req: AuthedRequest, res: Response) => {
  try {
    const { companyId: tenantCompanyId } = req;
    const { companyId } = req.params;

    // Ensure company belongs to tenant
    const [company] = await db
      .select({ id: customerCompanies.id })
      .from(customerCompanies)
      .where(and(eq(customerCompanies.id, companyId), eq(customerCompanies.companyId, tenantCompanyId!)))
      .limit(1);

    if (!company) return res.status(404).json({ error: "Customer company not found" });

    const locations = await db
      .select()
      .from(clients)
      .where(and(eq(clients.companyId, tenantCompanyId!), eq(clients.parentCompanyId, companyId)))
      .orderBy(desc(clients.createdAt));

    res.json(locations);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch locations" });
  }
});
/**
 * POST /api/customer-companies/:companyId/locations
 * Create a new location under a customer company
 */
router.post("/:companyId/locations", requireRole(MANAGER_ROLES), async (req: AuthedRequest, res: Response) => {
  try {
    const { companyId: tenantCompanyId, user } = req;
    const { companyId } = req.params;

    if (!tenantCompanyId || !user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Ensure customer company exists and belongs to tenant
    const [company] = await db
      .select()
      .from(customerCompanies)
      .where(and(eq(customerCompanies.id, companyId), eq(customerCompanies.companyId, tenantCompanyId)))
      .limit(1);

    if (!company) {
      return res.status(404).json({ error: "Customer company not found" });
    }

    // Create the location linked to this customer company
    const [newLocation] = await db
      .insert(clients)
      .values({
        companyId: tenantCompanyId,
        userId: user.id,
        parentCompanyId: companyId, // ✅ Link to customer company
        companyName: company.name, // Use parent company name
        location: req.body.location || "",
        address: req.body.address || null,
        city: req.body.city || null,
        province: req.body.province || null,
        postalCode: req.body.postalCode || null,
        contactName: req.body.contactName || null,
        email: req.body.email || null,
        phone: req.body.phone || null,
        roofLadderCode: req.body.roofLadderCode || null,
        billWithParent: req.body.billWithParent ?? true,
        inactive: req.body.inactive ?? false,
        isPrimary: false, // New locations are not primary by default
        needsDetails: false,
        selectedMonths: [],
      })
      .returning();

    res.status(201).json(newLocation);
  } catch (err: any) {
    console.error("Create location error:", err);
    res.status(500).json({ error: err?.message || "Failed to create location" });
  }
});
/**
 * GET /api/customer-companies/:companyId/overview
 * Single, canonical endpoint for the Company/Client detail page.
 * Aggregates jobs/invoices through locationIds (schema-correct, scalable, QBO-aligned).
 */
router.get("/:companyId/overview", async (req: AuthedRequest, res: Response) => {
  try {
    const { companyId: tenantCompanyId } = req;
    const { companyId } = req.params;

    const [company] = await db
      .select()
      .from(customerCompanies)
      .where(and(eq(customerCompanies.id, companyId), eq(customerCompanies.companyId, tenantCompanyId!)))
      .limit(1);

    if (!company) return res.status(404).json({ error: "Customer company not found" });

    const locations = await db
      .select()
      .from(clients)
      .where(and(eq(clients.companyId, tenantCompanyId!), eq(clients.parentCompanyId, companyId)))
      .orderBy(desc(clients.createdAt));

    const locationIds = locations.map((l) => l.id).filter(Boolean);

    // Jobs + invoices live on locationId. Roll up through locations.
    const jobsList =
      locationIds.length === 0
        ? []
        : await db
            .select()
            .from(jobs)
            .where(and(eq(jobs.companyId, tenantCompanyId!), inArray(jobs.locationId, locationIds)))
            .orderBy(desc(jobs.createdAt));

    const invoicesList =
      locationIds.length === 0
        ? []
        : await db
            .select()
            .from(invoices)
            .where(and(eq(invoices.companyId, tenantCompanyId!), inArray(invoices.locationId, locationIds)))
            .orderBy(desc(invoices.createdAt));

    // Minimal summary stats; extend later without breaking the FE contract.
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
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch company overview" });
  }
});

export default router;
