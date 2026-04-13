/**
 * Equipment routes — canonical owner for all /api/equipment/* endpoints.
 *
 * Includes: catalog item associations, service timeline, equipment-linked
 * notes history, equipment-linked parts history.
 *
 * Mounted at /api/equipment (see routes/index.ts)
 *
 * 2026-04-08: DB access delegated to storage/equipmentCatalog.ts and storage/clients.ts.
 */

import { Router, Response } from "express";
import { z } from "zod";
import { updateEquipmentCatalogItemSchema } from "../../shared/schema";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest } from "../auth/tenantIsolation";
import { fetchEquipmentHistoryRows, groupHistoryByJob } from "../services/equipmentHistory";
import { clientRepository } from "../storage/clients";
import { equipmentCatalogRepository } from "../storage/equipmentCatalog";
import { db } from "../db";
import { users } from "../../shared/schema";
import { and, eq, inArray } from "drizzle-orm";

const router = Router();

// ========================================
// Helpers
// ========================================

/** Verify equipment exists and belongs to company (allows soft-deleted for read-only history) */
async function getEquipmentOrThrow(companyId: string, equipmentId: string) {
  const eq = await clientRepository.getLocationEquipmentAny(companyId, equipmentId);
  if (!eq) throw createError(404, "Equipment not found");
  return eq;
}

/** Verify equipment exists, belongs to company, AND is active (for write operations) */
async function getActiveEquipmentOrThrow(companyId: string, equipmentId: string) {
  const eq = await clientRepository.getLocationEquipmentById(companyId, equipmentId);
  if (!eq) throw createError(404, "Equipment not found");
  return eq;
}

// ========================================
// Routes
// ========================================

/** GET /api/equipment/:equipmentId/catalog-items */
router.get("/:equipmentId/catalog-items", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  await getEquipmentOrThrow(companyId, req.params.equipmentId);
  const result = await equipmentCatalogRepository.getAssociationsWithItems(companyId, req.params.equipmentId);
  res.json(result);
}));

const addCatalogItemSchema = z.object({
  catalogItemId: z.string().uuid(),
  quantity: z.number().int().positive().default(1),
  notes: z.string().max(2000).nullable().optional(),
  sortOrder: z.number().int().nonnegative().default(0),
});

/** POST /api/equipment/:equipmentId/catalog-items */
router.post("/:equipmentId/catalog-items", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const { equipmentId } = req.params;

  await getActiveEquipmentOrThrow(companyId, equipmentId);

  const data = validateSchema(addCatalogItemSchema, req.body);

  // Verify catalog item belongs to company
  const item = await equipmentCatalogRepository.verifyCatalogItemOwnership(companyId, data.catalogItemId);
  if (!item) throw createError(404, "Catalog item not found");

  // Check for duplicate
  const existing = await equipmentCatalogRepository.findExistingAssociation(companyId, equipmentId, data.catalogItemId);
  if (existing) throw createError(409, "This catalog item is already associated with this equipment");

  await equipmentCatalogRepository.addAssociation({
    companyId,
    equipmentId,
    catalogItemId: data.catalogItemId,
    quantity: data.quantity ?? 1,
    notes: data.notes ?? null,
    sortOrder: data.sortOrder ?? 0,
  });

  // Return full list with joined data
  const result = await equipmentCatalogRepository.getAssociationsWithItems(companyId, equipmentId);
  res.status(201).json(result);
}));

/** PATCH /api/equipment/:equipmentId/catalog-items/:associationId */
router.patch("/:equipmentId/catalog-items/:associationId", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const { equipmentId, associationId } = req.params;

  await getActiveEquipmentOrThrow(companyId, equipmentId);

  const data = validateSchema(updateEquipmentCatalogItemSchema, req.body);

  const row = await equipmentCatalogRepository.getAssociation(companyId, equipmentId, associationId);
  if (!row) throw createError(404, "Association not found");

  await equipmentCatalogRepository.updateAssociation(associationId, data);

  const result = await equipmentCatalogRepository.getAssociationsWithItems(companyId, equipmentId);
  res.json(result);
}));

/** DELETE /api/equipment/:equipmentId/catalog-items/:associationId */
router.delete("/:equipmentId/catalog-items/:associationId", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const { equipmentId, associationId } = req.params;

  await getActiveEquipmentOrThrow(companyId, equipmentId);

  const row = await equipmentCatalogRepository.getAssociation(companyId, equipmentId, associationId);
  if (!row) throw createError(404, "Association not found");

  await equipmentCatalogRepository.deleteAssociation(associationId);

  res.json({ success: true });
}));

const reorderSchema = z.object({
  items: z.array(z.object({
    id: z.string().uuid(),
    sortOrder: z.number().int().nonnegative(),
  })),
});

/** POST /api/equipment/:equipmentId/catalog-items/reorder */
router.post("/:equipmentId/catalog-items/reorder", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const { equipmentId } = req.params;

  await getActiveEquipmentOrThrow(companyId, equipmentId);

  const data = validateSchema(reorderSchema, req.body);

  await equipmentCatalogRepository.reorderAssociations(companyId, equipmentId, data.items);

  const result = await equipmentCatalogRepository.getAssociationsWithItems(companyId, equipmentId);
  res.json(result);
}));

// ========================================
// Equipment Service Timeline (2026-03-06)
// ========================================

/** Map job.jobType to a timeline entry type */
function mapJobTypeToEntryType(jobType: string | null): string {
  switch (jobType) {
    case "maintenance": return "pm";
    case "inspection": return "inspection";
    case "installation": return "install";
    case "repair":
    case "emergency":
    default:
      return "service";
  }
}

/**
 * GET /api/equipment/:equipmentId/timeline
 * Returns newest-first timeline of visits tied to this equipment via job_equipment.
 */
router.get("/:equipmentId/timeline", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const { equipmentId } = req.params;

  await getEquipmentOrThrow(companyId, equipmentId);

  const rows = await equipmentCatalogRepository.getTimeline(companyId, equipmentId);

  // Resolve crew user names across all visits in one batched query.
  const crewIds = new Set<string>();
  for (const r of rows) {
    for (const id of r.assignedTechnicianIds ?? []) if (id) crewIds.add(id);
  }
  const nameById = new Map<string, string>();
  if (crewIds.size > 0) {
    const userRows = await db
      .select({ id: users.id, fullName: users.fullName, firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(and(eq(users.companyId, companyId), inArray(users.id, Array.from(crewIds))));
    for (const u of userRows) {
      const name = u.fullName || [u.firstName, u.lastName].filter(Boolean).join(" ") || null;
      if (name) nameById.set(u.id, name);
    }
  }

  // Map to display-ready shape
  const timeline = rows.map(r => {
    const date = r.visitDate || r.visitDateFallback;
    const entryType = mapJobTypeToEntryType(r.jobType);
    const title = entryType === "pm" ? "PM Visit"
      : entryType === "inspection" ? "Inspection"
      : entryType === "install" ? "Installation"
      : "Service Visit";

    const summary = r.visitNotes || r.outcomeNote || r.equipmentNotes || r.jobSummary || null;

    const crewNames = (r.assignedTechnicianIds ?? []).map(id => nameById.get(id)).filter(Boolean) as string[];
    const techName = crewNames.length > 0 ? crewNames.join(", ") : null;

    return {
      id: r.visitId,
      date: date?.toISOString() || null,
      entryType,
      title,
      summary,
      jobId: r.jobId,
      jobNumber: r.jobNumber,
      visitId: r.visitId,
      visitStatus: r.visitStatus,
      outcome: r.outcome,
      technicianName: techName,
    };
  });

  res.json(timeline);
}));

// ========================================
// GET /api/equipment/:equipmentId/notes
// ========================================

router.get("/:equipmentId/notes", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const { equipmentId } = req.params;

  await getEquipmentOrThrow(companyId, equipmentId);

  const rows = await equipmentCatalogRepository.getNotes(companyId, equipmentId);

  res.json(rows.map(r => ({
    id: r.id,
    text: r.noteText,
    author: r.userFirstName || r.userName || "Unknown",
    date: r.createdAt?.toISOString() || null,
    jobId: r.jobId,
  })));
}));

// ========================================
// GET /api/equipment/:equipmentId/parts
// ========================================

router.get("/:equipmentId/parts", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const { equipmentId } = req.params;

  await getEquipmentOrThrow(companyId, equipmentId);

  const rows = await equipmentCatalogRepository.getParts(companyId, equipmentId);

  res.json(rows.map(r => ({
    id: r.id,
    description: r.description,
    quantity: r.quantity,
    date: r.createdAt?.toISOString() || null,
    jobId: r.jobId,
  })));
}));

// ========================================
// GET /api/equipment/:equipmentId/history
// ========================================

router.get("/:equipmentId/history", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const { equipmentId } = req.params;

  await getEquipmentOrThrow(companyId, equipmentId);

  const rows = await fetchEquipmentHistoryRows(companyId, equipmentId);
  const history = groupHistoryByJob(rows);

  res.json(history);
}));

export default router;
