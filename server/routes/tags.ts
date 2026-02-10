/**
 * Client Tags API — Phase 1 + Phase 1B Location Tags
 *
 * Tag CRUD:  GET/POST/PATCH/DELETE /api/tags
 * Company assignments: GET/POST /api/customer-companies/:id/tags
 * Location assignments: GET/POST /api/locations/:locationId/tags
 */
import { Router, type Response } from "express";
import type { AuthedRequest } from "../auth/tenantIsolation";
import { asyncHandler } from "../middleware/errorHandler";
import { clientTagRepository } from "../storage/clientTags";
import { validateSchema } from "../utils/validationHelpers";
import { z } from "zod";

// ── Tag CRUD router (mounted at /api/tags) ──────────────────────
export const tagCrudRouter = Router();

const createTagSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

const updateTagSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

/** GET /api/tags — list all tags for this tenant */
tagCrudRouter.get("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const tags = await clientTagRepository.getTagsByCompany(req.companyId);
  res.json(tags);
}));

/** POST /api/tags — create a new tag */
tagCrudRouter.post("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const data = validateSchema(createTagSchema, req.body);
  try {
    const tag = await clientTagRepository.createTag(req.companyId, data);
    res.status(201).json(tag);
  } catch (err: any) {
    // Unique constraint violation → duplicate name
    if (err.code === "23505") {
      return res.status(409).json({ error: "A tag with that name already exists" });
    }
    throw err;
  }
}));

/** PATCH /api/tags/:tagId — update tag name/color */
tagCrudRouter.patch("/:tagId", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const data = validateSchema(updateTagSchema, req.body);
  try {
    const tag = await clientTagRepository.updateTag(req.companyId, req.params.tagId, data);
    res.json(tag);
  } catch (err: any) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "A tag with that name already exists" });
    }
    throw err;
  }
}));

/** DELETE /api/tags/:tagId — delete tag (cascades assignments) */
tagCrudRouter.delete("/:tagId", asyncHandler(async (req: AuthedRequest, res: Response) => {
  await clientTagRepository.deleteTag(req.companyId, req.params.tagId);
  res.status(204).end();
}));

/** GET /api/tags/assignments — all customer-company tag assignments for the tenant (for list views) */
tagCrudRouter.get("/assignments", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const assignments = await clientTagRepository.getTagAssignmentsByCompany(req.companyId);
  res.json(assignments);
}));

/** GET /api/tags/location-assignments — all location tag assignments for the tenant (for list views) */
tagCrudRouter.get("/location-assignments", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const assignments = await clientTagRepository.getLocationTagAssignmentsByCompany(req.companyId);
  res.json(assignments);
}));

// ── Customer-company tag assignment router (mounted on /api/customer-companies) ──

export const customerCompanyTagRouter = Router();

const updateAssignmentsSchema = z.object({
  addTagIds: z.array(z.string()).default([]),
  removeTagIds: z.array(z.string()).default([]),
});

// ── Phase 2A: Bulk tag operations (registered BEFORE /:id routes to avoid param capture) ──

const bulkTagsSchema = z.object({
  customerCompanyIds: z.array(z.string().uuid()).min(1, "At least one customer company ID required"),
  addTagIds: z.array(z.string().uuid()).default([]),
  removeTagIds: z.array(z.string().uuid()).default([]),
});

/** POST /api/customer-companies/bulk-tags — bulk add/remove tags for multiple customer companies */
customerCompanyTagRouter.post("/bulk-tags", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const data = validateSchema(bulkTagsSchema, req.body);
  const addTagIds = data.addTagIds ?? [];
  const removeTagIds = data.removeTagIds ?? [];

  if (!addTagIds.length && !removeTagIds.length) {
    return res.status(400).json({ error: "Must provide at least one tag to add or remove" });
  }

  // Prevent overlap: same tag in both add and remove
  const overlap = addTagIds.filter((id) => removeTagIds.includes(id));
  if (overlap.length > 0) {
    return res.status(400).json({ error: "Cannot add and remove the same tag in one operation" });
  }

  const result = await clientTagRepository.bulkUpdateCustomerCompanyTags(
    req.companyId,
    data.customerCompanyIds,
    addTagIds,
    removeTagIds,
  );
  res.json(result);
}));

/** GET /api/customer-companies/:id/tags — tags for a customer company */
customerCompanyTagRouter.get("/:id/tags", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const tags = await clientTagRepository.getTagsForCustomerCompany(req.companyId, req.params.id);
  res.json(tags);
}));

/** POST /api/customer-companies/:id/tags — add/remove tags */
customerCompanyTagRouter.post("/:id/tags", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const data = validateSchema(updateAssignmentsSchema, req.body);
  const tags = await clientTagRepository.updateCustomerCompanyTags(
    req.companyId,
    req.params.id,
    data.addTagIds ?? [],
    data.removeTagIds ?? [],
  );
  res.json(tags);
}));

// ── Phase 1B: Location tag assignment router (mounted on /api/locations) ──

export const locationTagRouter = Router();

// ── Phase 2B: Bulk location tag operations (registered BEFORE /:id routes to avoid param capture) ──

const bulkLocationTagsSchema = z.object({
  locationIds: z.array(z.string().uuid()).min(1, "At least one location ID required"),
  addTagIds: z.array(z.string().uuid()).default([]),
  removeTagIds: z.array(z.string().uuid()).default([]),
});

/** POST /api/locations/bulk-tags — bulk add/remove tags for multiple locations */
locationTagRouter.post("/bulk-tags", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const data = validateSchema(bulkLocationTagsSchema, req.body);
  const addTagIds = data.addTagIds ?? [];
  const removeTagIds = data.removeTagIds ?? [];

  if (!addTagIds.length && !removeTagIds.length) {
    return res.status(400).json({ error: "Must provide at least one tag to add or remove" });
  }

  // Prevent overlap: same tag in both add and remove
  const overlap = addTagIds.filter((id) => removeTagIds.includes(id));
  if (overlap.length > 0) {
    return res.status(400).json({ error: "Cannot add and remove the same tag in one operation" });
  }

  const result = await clientTagRepository.bulkUpdateLocationTags(
    req.companyId,
    data.locationIds,
    addTagIds,
    removeTagIds,
  );
  res.json(result);
}));

/** GET /api/locations/:locationId/tags — tags for a location */
locationTagRouter.get("/:locationId/tags", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const tags = await clientTagRepository.getTagsForLocation(req.companyId, req.params.locationId);
  res.json(tags);
}));

/** POST /api/locations/:locationId/tags — add/remove tags for a location */
locationTagRouter.post("/:locationId/tags", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const data = validateSchema(updateAssignmentsSchema, req.body);
  const tags = await clientTagRepository.updateLocationTags(
    req.companyId,
    req.params.locationId,
    data.addTagIds ?? [],
    data.removeTagIds ?? [],
  );
  res.json(tags);
}));
