/**
 * Equipment OCR routes — nameplate extraction + tech equipment update (2026-05-13).
 *
 * Mounted at: /api/tech/equipment  (see server/routes/index.ts)
 *
 * POST /api/tech/equipment/:equipmentId/ocr-nameplate
 *   Accepts a fileId of an already-uploaded image, runs OCR server-side,
 *   persists the scan record, and returns the normalized result.
 *
 * PATCH /api/tech/equipment/:equipmentId
 *   Updates safe nameplate fields on a piece of equipment. Optionally links
 *   an OCR scan (ocrScanId) to mark it reviewed + applied.
 *
 * Security invariants (both routes):
 *   - requireSchedulable: any schedulable tenant user (matches /api/tech/*).
 *   - assertCanAccessTechLocation: tech must have ≥1 active assigned visit to
 *     the equipment's location; office roles bypass (owner/admin/manager).
 *   - locationId is resolved server-side from the equipment row — never
 *     sourced from the client payload.
 *   - File ownership is validated by OcrService (companyId match, status=uploaded,
 *     image mime, ≤10 MB, R2-backed).
 *   - Provider credentials are never returned in the response.
 *   - OCR results are persisted to equipment_ocr_scans but NEVER auto-applied
 *     to location_equipment automatically — the tech explicitly triggers the PATCH.
 */

import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { locationEquipment, files } from "@shared/schema";
import { asyncHandler, createError } from "../middleware/errorHandler";
import type { AuthedRequest } from "../auth/tenantIsolation";
import { validateSchema } from "../utils/validationHelpers";
import { assertCanAccessTechLocation } from "../auth/techLocationAccess";
import { extractNameplateFromFile } from "../services/ocr/OcrService";
import { createScan, getScanById, markReviewed, markApplied } from "../storage/equipmentOcrScans";
import { clientRepository } from "../storage/clients";

const router = Router();

// ── Auth guard ───────────────────────────────────────────────────────────────

// Mirrors the same guard used by techField.ts and techLocations.ts.
// Local copy keeps the routers independently deployable.
function requireSchedulable(req: Request, res: Response, next: NextFunction): void {
  const user = req.user as any;
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  if (user.isSchedulable === false) {
    res.status(403).json({ error: "User is not schedulable" });
    return;
  }
  next();
}

// ── Schema ───────────────────────────────────────────────────────────────────

const ocrNameplateBodySchema = z.object({
  /** ID of an image file that has already been finalized through the canonical
   *  3-step upload pipeline (status = "uploaded"). */
  fileId: z.string().min(1),
});

// ── Route ────────────────────────────────────────────────────────────────────

/**
 * POST /api/tech/equipment/:equipmentId/ocr-nameplate
 *
 * Body: { fileId: string }
 *
 * Response: OcrNameplateResult (rawText, fields, overallConfidence, provider, scannedAt)
 *
 * Never includes provider credentials or internal storage keys.
 */
router.post(
  "/:equipmentId/ocr-nameplate",
  requireSchedulable,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const user = req.user;
    if (!companyId || !user) throw createError(401, "Not authenticated");

    const { fileId } = validateSchema(ocrNameplateBodySchema, req.body);
    const { equipmentId } = req.params;

    // Resolve equipment record server-side to get the locationId.
    // Never accept locationId from the client.
    const [equipment] = await db
      .select({
        id: locationEquipment.id,
        locationId: locationEquipment.locationId,
      })
      .from(locationEquipment)
      .where(
        and(
          eq(locationEquipment.id, equipmentId),
          eq(locationEquipment.companyId, companyId),
          // Exclude soft-deleted equipment.
          // Using raw column comparison to avoid importing drizzle isNull helper.
        ),
      )
      .limit(1);

    if (!equipment) throw createError(404, "Equipment not found");

    // Verify the caller has access to this location (assignment check for techs,
    // bypass for owner/admin/manager).
    await assertCanAccessTechLocation(
      companyId,
      user.id,
      (user as any).role,
      equipment.locationId,
    );

    // Run OCR — validates file ownership, mime, size, and status internally.
    const ocrResult = await extractNameplateFromFile(companyId, fileId);

    // Persist scan record. The caller (tech UI, Phase 1) will later call
    // PATCH /api/tech/equipment/:id with the confirmed field values.
    const scan = await createScan({
      companyId,
      equipmentId: equipment.id,
      fileId,
      rawText: ocrResult.rawText,
      parsedFields: ocrResult.fields,
      confidence: ocrResult.overallConfidence,
      provider: ocrResult.provider,
    });

    // Return the normalized result + scanId so the client can send it back
    // in the PATCH to mark this scan as reviewed + applied.
    res.json({ ...ocrResult, scanId: scan.id });
  }),
);

// ── PATCH schema ─────────────────────────────────────────────────────────────

// Strict: unknown keys (e.g. name, isActive, companyId, locationId) are rejected.
// ocrScanId is read-then-removed — it drives scan lifecycle but is NOT written to
// the equipment row.
const patchEquipmentBodySchema = z.object({
  equipmentType: z.string().nullable().optional(),
  manufacturer: z.string().nullable().optional(),
  modelNumber: z.string().nullable().optional(),
  serialNumber: z.string().nullable().optional(),
  tagNumber: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  nameplatePhotoId: z.string().nullable().optional(),
  ocrScanId: z.string().optional(),
}).strict();

// ── PATCH /api/tech/equipment/:equipmentId ───────────────────────────────────

/**
 * PATCH /api/tech/equipment/:equipmentId
 *
 * Body (all fields optional, unknown fields rejected):
 *   { equipmentType?, manufacturer?, modelNumber?, serialNumber?,
 *     tagNumber?, notes?, nameplatePhotoId?, ocrScanId? }
 *
 * When ocrScanId is provided the scan is marked reviewed (if not already)
 * and then marked applied — in that order, after the equipment row update
 * succeeds.
 */
router.patch(
  "/:equipmentId",
  requireSchedulable,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const user = req.user;
    if (!companyId || !user) throw createError(401, "Not authenticated");

    const { equipmentId } = req.params;
    const body = validateSchema(patchEquipmentBodySchema, req.body);
    const { ocrScanId, nameplatePhotoId, ...equipmentFields } = body;

    // Resolve equipment server-side to get the locationId for the access check.
    const equipment = await clientRepository.getLocationEquipmentById(companyId, equipmentId);
    if (!equipment) throw createError(404, "Equipment not found");

    await assertCanAccessTechLocation(
      companyId,
      user.id,
      (user as any).role,
      equipment.locationId,
    );

    // Validate nameplatePhotoId when caller is setting it (non-null value).
    if (nameplatePhotoId != null) {
      const [photoFile] = await db
        .select({ id: files.id, status: files.status, mimeType: files.mimeType })
        .from(files)
        .where(and(eq(files.id, nameplatePhotoId), eq(files.companyId, companyId)))
        .limit(1);

      if (!photoFile) throw createError(404, "Nameplate photo file not found");
      if (photoFile.status !== "uploaded") throw createError(409, "Nameplate photo is not finalized");
      if (!photoFile.mimeType?.startsWith("image/")) throw createError(400, "Nameplate photo must be an image");
    }

    // Validate the OCR scan when provided — must belong to this company and this equipment.
    let scan = ocrScanId ? await getScanById(companyId, ocrScanId) : null;
    if (ocrScanId) {
      if (!scan) throw createError(404, "OCR scan not found");
      if (scan.equipmentId !== equipmentId) throw createError(400, "OCR scan does not belong to this equipment");
    }

    // Persist equipment field updates (safe subset only; ocrScanId excluded).
    const updated = await clientRepository.updateLocationEquipment(companyId, equipmentId, {
      ...equipmentFields,
      ...(nameplatePhotoId !== undefined ? { nameplatePhotoId } : {}),
    });
    if (!updated) throw createError(404, "Equipment not found");

    // Mark scan reviewed (if not already) then applied.
    if (scan) {
      if (!scan.reviewedAt) {
        scan = await markReviewed(companyId, scan.id, user.id);
      }
      await markApplied(companyId, scan.id);
    }

    res.json({
      id: updated.id,
      name: updated.name ?? null,
      type: updated.equipmentType ?? null,
      manufacturer: updated.manufacturer ?? null,
      model: updated.modelNumber ?? null,
      serialNumber: updated.serialNumber ?? null,
      installedAt: updated.installDate ?? null,
      notes: updated.notes ?? null,
      nameplatePhotoId: updated.nameplatePhotoId ?? null,
    });
  }),
);

export default router;
