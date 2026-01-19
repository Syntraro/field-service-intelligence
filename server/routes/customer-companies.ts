import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { parsePaginationLenient } from "../utils/pagination";
import { paginatedCompat } from "../utils/paginatedResponse";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest } from "../auth/tenantIsolation";
import { customerCompanyRepository } from "../storage/customerCompanies";

function requireCompanyContext(req: any, res: Response, next: NextFunction) {
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
      contactName: req.body.contactName || null,
      email: req.body.email || null,
      phone: req.body.phone || null,
      roofLadderCode: req.body.roofLadderCode || null,
      billWithParent: req.body.billWithParent ?? true,
      inactive: req.body.inactive ?? false,
    }
  );

  res.status(201).json(newLocation);
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
    orphan.companyName.toLowerCase().trim() === customerCompany.name.toLowerCase().trim()
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
