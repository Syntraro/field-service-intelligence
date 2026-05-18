/**
 * Technician Shift Templates — storage layer (2026-05-18 Phase 1).
 *
 * Thin Drizzle wrapper over the `technician_shift_templates` table.
 * CRUD-only: no business logic, no recurrence, no overlap checks.
 * Permission enforcement and tenant validation live in the route handler.
 *
 * Operations:
 *   • list(companyId) — all templates for the company
 *   • findById(companyId, id) — null if not found or cross-tenant
 *   • create(companyId, input, createdByUserId) — INSERT returning
 *   • update(companyId, id, patch) — UPDATE returning null if not found
 *   • hardDelete(companyId, id) — nullifies template_id on shifts, then deletes
 */
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import {
  technicianShiftTemplates,
  technicianShifts,
  type TechnicianShiftTemplate,
  type InsertTechnicianShiftTemplate,
} from "@shared/schema";

async function list(companyId: string): Promise<TechnicianShiftTemplate[]> {
  return await db
    .select()
    .from(technicianShiftTemplates)
    .where(eq(technicianShiftTemplates.companyId, companyId));
}

/** Single-row read. Returns null when not found or cross-tenant. */
async function findById(
  companyId: string,
  id: string,
): Promise<TechnicianShiftTemplate | null> {
  const rows = await db
    .select()
    .from(technicianShiftTemplates)
    .where(
      and(
        eq(technicianShiftTemplates.companyId, companyId),
        eq(technicianShiftTemplates.id, id),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function create(
  companyId: string,
  input: {
    name: string;
    shiftType: "normal" | "on_call" | "unavailable";
    shiftSubtype?: "vacation" | "sick" | "personal" | "training" | "holiday" | "scheduled_off" | "other" | null;
    label?: string | null;
    color?: string | null;
    timeOfDayStart?: string | null;
    timeOfDayEnd?: string | null;
    recurrenceRule?: string | null;
    isActive?: boolean;
  },
  createdByUserId: string,
): Promise<TechnicianShiftTemplate> {
  const insert: InsertTechnicianShiftTemplate = {
    companyId,
    name: input.name,
    shiftType: input.shiftType,
    shiftSubtype: input.shiftSubtype ?? null,
    label: input.label ?? null,
    color: input.color ?? null,
    timeOfDayStart: input.timeOfDayStart ?? null,
    timeOfDayEnd: input.timeOfDayEnd ?? null,
    recurrenceRule: input.recurrenceRule ?? null,
    isActive: input.isActive ?? true,
    createdByUserId,
  };
  const rows = await db
    .insert(technicianShiftTemplates)
    .values(insert)
    .returning();
  if (rows.length === 0) {
    throw new Error("Failed to insert technician_shift_templates row");
  }
  return rows[0];
}

async function update(
  companyId: string,
  id: string,
  patch: Partial<{
    name: string;
    shiftType: "normal" | "on_call" | "unavailable";
    shiftSubtype: "vacation" | "sick" | "personal" | "training" | "holiday" | "scheduled_off" | "other" | null;
    label: string | null;
    color: string | null;
    timeOfDayStart: string | null;
    timeOfDayEnd: string | null;
    recurrenceRule: string | null;
    isActive: boolean;
  }>,
): Promise<TechnicianShiftTemplate | null> {
  const patchValues: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) patchValues.name = patch.name;
  if (patch.shiftType !== undefined) patchValues.shiftType = patch.shiftType;
  if (patch.shiftSubtype !== undefined) patchValues.shiftSubtype = patch.shiftSubtype;
  if (patch.label !== undefined) patchValues.label = patch.label;
  if (patch.color !== undefined) patchValues.color = patch.color;
  if (patch.timeOfDayStart !== undefined) patchValues.timeOfDayStart = patch.timeOfDayStart;
  if (patch.timeOfDayEnd !== undefined) patchValues.timeOfDayEnd = patch.timeOfDayEnd;
  if (patch.recurrenceRule !== undefined) patchValues.recurrenceRule = patch.recurrenceRule;
  if (patch.isActive !== undefined) patchValues.isActive = patch.isActive;

  const rows = await db
    .update(technicianShiftTemplates)
    .set(patchValues)
    .where(
      and(
        eq(technicianShiftTemplates.companyId, companyId),
        eq(technicianShiftTemplates.id, id),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

/**
 * Hard-delete a template. Nullifies template_id on any shifts that reference
 * it (so shift history is preserved), then deletes the template row.
 * Returns false if the template does not exist or belongs to a different tenant.
 */
async function hardDelete(companyId: string, id: string): Promise<boolean> {
  return await db.transaction(async (tx) => {
    // Verify ownership before mutating.
    const existing = await tx
      .select({ id: technicianShiftTemplates.id })
      .from(technicianShiftTemplates)
      .where(
        and(
          eq(technicianShiftTemplates.companyId, companyId),
          eq(technicianShiftTemplates.id, id),
        ),
      )
      .limit(1);
    if (existing.length === 0) return false;

    // Nullify template_id on shifts that reference this template.
    await tx
      .update(technicianShifts)
      .set({ templateId: null })
      .where(
        and(
          eq(technicianShifts.companyId, companyId),
          eq(technicianShifts.templateId, id),
        ),
      );

    await tx
      .delete(technicianShiftTemplates)
      .where(
        and(
          eq(technicianShiftTemplates.companyId, companyId),
          eq(technicianShiftTemplates.id, id),
        ),
      );

    return true;
  });
}

export const technicianShiftTemplatesRepository = {
  list,
  findById,
  create,
  update,
  hardDelete,
};
