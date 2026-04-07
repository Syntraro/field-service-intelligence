/**
 * Equipment routes — canonical owner for all /api/equipment/* endpoints.
 *
 * Includes: catalog item associations, service timeline, equipment-linked
 * notes history, equipment-linked parts history.
 *
 * Mounted at /api/equipment (see routes/index.ts)
 */

import { Router, Response } from "express";
import { z } from "zod";
import { eq, and, asc, desc, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  equipmentCatalogItems, locationEquipment, items,
  updateEquipmentCatalogItemSchema,
  jobEquipment, jobs, jobVisits, users, jobNotes, jobParts,
} from "../../shared/schema";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest } from "../auth/tenantIsolation";
import { fetchEquipmentHistoryRows, groupHistoryByJob } from "../services/equipmentHistory";

const router = Router();

// ========================================
// Helpers
// ========================================

/** Verify equipment exists and belongs to company (allows soft-deleted for read-only history) */
async function getEquipmentOrThrow(companyId: string, equipmentId: string) {
  const rows = await db
    .select()
    .from(locationEquipment)
    .where(and(eq(locationEquipment.companyId, companyId), eq(locationEquipment.id, equipmentId)))
    .limit(1);
  if (!rows[0]) throw createError(404, "Equipment not found");
  return rows[0];
}

/** Verify equipment exists, belongs to company, AND is active (for write operations) */
async function getActiveEquipmentOrThrow(companyId: string, equipmentId: string) {
  const rows = await db
    .select()
    .from(locationEquipment)
    .where(and(eq(locationEquipment.companyId, companyId), eq(locationEquipment.id, equipmentId), eq(locationEquipment.isActive, true)))
    .limit(1);
  if (!rows[0]) throw createError(404, "Equipment not found");
  return rows[0];
}

/** Fetch associations with joined catalog item data */
async function fetchAssociationsWithItems(companyId: string, equipmentId: string) {
  const rows = await db
    .select({
      id: equipmentCatalogItems.id,
      equipmentId: equipmentCatalogItems.equipmentId,
      catalogItemId: equipmentCatalogItems.catalogItemId,
      quantity: equipmentCatalogItems.quantity,
      notes: equipmentCatalogItems.notes,
      sortOrder: equipmentCatalogItems.sortOrder,
      createdAt: equipmentCatalogItems.createdAt,
      updatedAt: equipmentCatalogItems.updatedAt,
      catalogItemName: items.name,
      catalogItemSku: items.sku,
      catalogItemType: items.type,
      catalogItemDescription: items.description,
      catalogItemUnitPrice: items.unitPrice,
    })
    .from(equipmentCatalogItems)
    .innerJoin(items, eq(equipmentCatalogItems.catalogItemId, items.id))
    .where(
      and(
        eq(equipmentCatalogItems.companyId, companyId),
        eq(equipmentCatalogItems.equipmentId, equipmentId),
      )
    )
    .orderBy(asc(equipmentCatalogItems.sortOrder), asc(equipmentCatalogItems.createdAt));

  return rows.map(r => ({
    id: r.id,
    equipmentId: r.equipmentId,
    catalogItemId: r.catalogItemId,
    quantity: r.quantity,
    notes: r.notes,
    sortOrder: r.sortOrder,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    catalogItem: {
      id: r.catalogItemId,
      name: r.catalogItemName,
      code: r.catalogItemSku,
      type: r.catalogItemType,
      description: r.catalogItemDescription,
      unitPrice: r.catalogItemUnitPrice,
    },
  }));
}

// ========================================
// Routes
// ========================================

/** GET /api/equipment/:equipmentId/catalog-items */
router.get("/:equipmentId/catalog-items", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  await getEquipmentOrThrow(companyId, req.params.equipmentId);
  const result = await fetchAssociationsWithItems(companyId, req.params.equipmentId);
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
  const itemRows = await db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.companyId, companyId), eq(items.id, data.catalogItemId)))
    .limit(1);
  if (!itemRows[0]) throw createError(404, "Catalog item not found");

  // Check for duplicate
  const existing = await db
    .select({ id: equipmentCatalogItems.id })
    .from(equipmentCatalogItems)
    .where(
      and(
        eq(equipmentCatalogItems.companyId, companyId),
        eq(equipmentCatalogItems.equipmentId, equipmentId),
        eq(equipmentCatalogItems.catalogItemId, data.catalogItemId),
      )
    )
    .limit(1);
  if (existing[0]) throw createError(409, "This catalog item is already associated with this equipment");

  await db.insert(equipmentCatalogItems).values({
    companyId,
    equipmentId,
    catalogItemId: data.catalogItemId,
    quantity: data.quantity,
    notes: data.notes ?? null,
    sortOrder: data.sortOrder,
  });

  // Return full list with joined data
  const result = await fetchAssociationsWithItems(companyId, equipmentId);
  res.status(201).json(result);
}));

/** PATCH /api/equipment/:equipmentId/catalog-items/:associationId */
router.patch("/:equipmentId/catalog-items/:associationId", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const { equipmentId, associationId } = req.params;

  await getActiveEquipmentOrThrow(companyId, equipmentId);

  const data = validateSchema(updateEquipmentCatalogItemSchema, req.body);

  const rows = await db
    .select({ id: equipmentCatalogItems.id })
    .from(equipmentCatalogItems)
    .where(
      and(
        eq(equipmentCatalogItems.companyId, companyId),
        eq(equipmentCatalogItems.id, associationId),
        eq(equipmentCatalogItems.equipmentId, equipmentId),
      )
    )
    .limit(1);
  if (!rows[0]) throw createError(404, "Association not found");

  await db
    .update(equipmentCatalogItems)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(equipmentCatalogItems.id, associationId));

  const result = await fetchAssociationsWithItems(companyId, equipmentId);
  res.json(result);
}));

/** DELETE /api/equipment/:equipmentId/catalog-items/:associationId */
router.delete("/:equipmentId/catalog-items/:associationId", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const { equipmentId, associationId } = req.params;

  await getActiveEquipmentOrThrow(companyId, equipmentId);

  const rows = await db
    .select({ id: equipmentCatalogItems.id })
    .from(equipmentCatalogItems)
    .where(
      and(
        eq(equipmentCatalogItems.companyId, companyId),
        eq(equipmentCatalogItems.id, associationId),
        eq(equipmentCatalogItems.equipmentId, equipmentId),
      )
    )
    .limit(1);
  if (!rows[0]) throw createError(404, "Association not found");

  await db
    .delete(equipmentCatalogItems)
    .where(eq(equipmentCatalogItems.id, associationId));

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

  // Update sort orders in batch
  await Promise.all(
    data.items.map(item =>
      db
        .update(equipmentCatalogItems)
        .set({ sortOrder: item.sortOrder, updatedAt: new Date() })
        .where(
          and(
            eq(equipmentCatalogItems.companyId, companyId),
            eq(equipmentCatalogItems.id, item.id),
            eq(equipmentCatalogItems.equipmentId, equipmentId),
          )
        )
    )
  );

  const result = await fetchAssociationsWithItems(companyId, equipmentId);
  res.json(result);
}));

// ========================================
// Equipment Service Timeline (2026-03-06)
// Aggregates visit-level history for a specific equipment record.
// Join path: location_equipment → job_equipment → jobs → job_visits → users
// ========================================

/**
 * GET /api/equipment/:equipmentId/timeline
 * Returns newest-first timeline of visits tied to this equipment via job_equipment.
 */
router.get("/:equipmentId/timeline", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const { equipmentId } = req.params;

  await getEquipmentOrThrow(companyId, equipmentId);

  // Join: job_equipment → jobs → job_visits, with optional tech user join
  const rows = await db
    .select({
      visitId: jobVisits.id,
      jobId: jobs.id,
      jobNumber: jobs.jobNumber,
      jobType: jobs.jobType,
      jobSummary: jobs.summary,
      visitDate: jobVisits.scheduledStart,
      visitDateFallback: jobVisits.scheduledDate,
      visitStatus: jobVisits.status,
      visitNotes: jobVisits.visitNotes,
      outcome: jobVisits.outcome,
      outcomeNote: jobVisits.outcomeNote,
      completedAt: jobVisits.completedAt,
      equipmentNotes: jobEquipment.notes,
      techFirstName: users.firstName,
      techLastName: users.lastName,
      techFullName: users.fullName,
    })
    .from(jobEquipment)
    .innerJoin(jobs, eq(jobEquipment.jobId, jobs.id))
    .innerJoin(jobVisits, and(
      eq(jobVisits.jobId, jobs.id),
      eq(jobVisits.isActive, true),
      isNull(jobVisits.archivedAt),
    ))
    .leftJoin(users, eq(jobVisits.assignedTechnicianId, users.id))
    .where(
      and(
        eq(jobEquipment.companyId, companyId),
        eq(jobEquipment.equipmentId, equipmentId),
      )
    )
    .orderBy(desc(jobVisits.scheduledStart), desc(jobVisits.scheduledDate))
    .limit(50);

  // Map to display-ready shape
  const timeline = rows.map(r => {
    const date = r.visitDate || r.visitDateFallback;
    const entryType = mapJobTypeToEntryType(r.jobType);
    const title = entryType === "pm" ? "PM Visit"
      : entryType === "inspection" ? "Inspection"
      : entryType === "install" ? "Installation"
      : "Service Visit";

    // Build summary: prefer visit notes/outcome, fall back to job summary
    const summary = r.visitNotes || r.outcomeNote || r.equipmentNotes || r.jobSummary || null;

    const techName = r.techFullName
      || (r.techFirstName && r.techLastName ? `${r.techFirstName} ${r.techLastName}` : null)
      || r.techFirstName || null;

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

// ========================================
// GET /api/equipment/:equipmentId/notes
// Notes linked to this equipment (via job_notes.equipment_id)
// ========================================

router.get("/:equipmentId/notes", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const { equipmentId } = req.params;

  await getEquipmentOrThrow(companyId, equipmentId);

  const rows = await db
    .select({
      id: jobNotes.id,
      noteText: jobNotes.noteText,
      createdAt: jobNotes.createdAt,
      jobId: jobNotes.jobId,
      userName: users.fullName,
      userFirstName: users.firstName,
    })
    .from(jobNotes)
    .leftJoin(users, eq(jobNotes.userId, users.id))
    .where(
      and(
        eq(jobNotes.companyId, companyId),
        eq(jobNotes.equipmentId, equipmentId),
      )
    )
    .orderBy(desc(jobNotes.createdAt))
    .limit(50);

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
// Parts linked to this equipment (via job_parts.equipment_id)
// ========================================

router.get("/:equipmentId/parts", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const { equipmentId } = req.params;

  await getEquipmentOrThrow(companyId, equipmentId);

  const rows = await db
    .select({
      id: jobParts.id,
      description: jobParts.description,
      quantity: jobParts.quantity,
      createdAt: jobParts.createdAt,
      jobId: jobParts.jobId,
    })
    .from(jobParts)
    .where(
      and(
        eq(jobParts.companyId, companyId),
        eq(jobParts.equipmentId, equipmentId),
        isNull(jobParts.deletedAt),
      )
    )
    .orderBy(desc(jobParts.createdAt))
    .limit(50);

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
// Equipment service history: notes grouped by job with per-note author attribution.
// Route → Service → Storage layering via equipmentHistory.ts
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
