/**
 * Storage layer for equipment_ocr_scans.
 *
 * OCR scans are append-only records of nameplate extraction attempts.
 * They are NEVER auto-applied to the parent location_equipment row —
 * that step is Phase 1 UI (tech review + explicit save).
 *
 * Phase 0 surface: createScan, getScanById, markReviewed, markApplied.
 */

import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { equipmentOcrScans } from "@shared/schema";
import type { EquipmentOcrScan } from "@shared/schema";
import { createError } from "../middleware/errorHandler";

export interface CreateScanInput {
  companyId: string;
  equipmentId: string;
  fileId: string;
  rawText: string | null;
  /** Parsed field map JSON — see OcrProvider.OcrFieldMap. */
  parsedFields: object | null;
  /** Overall confidence 0–1. null if provider didn't return one. */
  confidence: number | null;
  provider: string;
}

export async function createScan(input: CreateScanInput): Promise<EquipmentOcrScan> {
  const [row] = await db
    .insert(equipmentOcrScans)
    .values({
      companyId: input.companyId,
      equipmentId: input.equipmentId,
      fileId: input.fileId,
      rawText: input.rawText ?? null,
      parsedFields: input.parsedFields ?? null,
      // numeric column — Drizzle expects string for numeric precision columns.
      confidence: input.confidence !== null && input.confidence !== undefined
        ? String(input.confidence)
        : null,
      provider: input.provider,
    })
    .returning();
  return row;
}

export async function getScanById(
  companyId: string,
  scanId: string,
): Promise<EquipmentOcrScan | null> {
  const [row] = await db
    .select()
    .from(equipmentOcrScans)
    .where(
      and(
        eq(equipmentOcrScans.id, scanId),
        eq(equipmentOcrScans.companyId, companyId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Mark a scan as reviewed by a user. Called from Phase 1 UI when the tech
 * confirms they have verified the extracted fields.
 */
export async function markReviewed(
  companyId: string,
  scanId: string,
  reviewedById: string,
): Promise<EquipmentOcrScan> {
  const [row] = await db
    .update(equipmentOcrScans)
    .set({ reviewedAt: new Date(), reviewedById })
    .where(
      and(
        eq(equipmentOcrScans.id, scanId),
        eq(equipmentOcrScans.companyId, companyId),
      ),
    )
    .returning();
  if (!row) throw createError(404, "OCR scan not found");
  return row;
}

/**
 * Mark a scan as applied — the reviewed fields were written back to
 * location_equipment. Called from Phase 1 UI after a successful PATCH.
 */
export async function markApplied(
  companyId: string,
  scanId: string,
): Promise<EquipmentOcrScan> {
  const [row] = await db
    .update(equipmentOcrScans)
    .set({ appliedAt: new Date() })
    .where(
      and(
        eq(equipmentOcrScans.id, scanId),
        eq(equipmentOcrScans.companyId, companyId),
      ),
    )
    .returning();
  if (!row) throw createError(404, "OCR scan not found");
  return row;
}
