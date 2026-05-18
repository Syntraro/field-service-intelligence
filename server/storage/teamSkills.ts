/**
 * Team skills storage — company skill library + member skill assignments.
 *
 * All queries are scoped by companyId. Tenant isolation is enforced at
 * every read and write path; no cross-company data leaks are possible.
 *
 * Expiry status is computed server-side (not stored):
 *   expired       — certificationExpiresAt < now
 *   expiring_soon — certificationExpiresAt within 30 days
 *   valid         — certificationExpiresAt ≥ now + 30 days
 *   null          — no expiry date set
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { teamSkills, teamMemberSkills, SKILL_LEVELS } from "@shared/schema";
import type { SkillLevel } from "@shared/schema";

export type { SkillLevel };

const EXPIRY_SOON_DAYS = 30;

// ── Public shapes ──────────────────────────────────────────────────────────

export interface TeamSkillLibraryItem {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  isActive: boolean;
  memberCount: number;
  createdAt: Date;
  updatedAt: Date | null;
}

export type ExpiryStatus = "valid" | "expiring_soon" | "expired";

export interface TeamMemberSkillRow {
  id: string;
  skillId: string;
  name: string;
  category: string | null;
  level: SkillLevel;
  certificationName: string | null;
  certificationExpiresAt: Date | null;
  notes: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date | null;
  expiryStatus: ExpiryStatus | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function computeExpiryStatus(expiresAt: Date | null): ExpiryStatus | null {
  if (!expiresAt) return null;
  const now = new Date();
  if (expiresAt < now) return "expired";
  const soonThreshold = new Date(now.getTime() + EXPIRY_SOON_DAYS * 86_400_000);
  if (expiresAt <= soonThreshold) return "expiring_soon";
  return "valid";
}

/** Normalize a skill name for duplicate detection (lowercase + trim). */
function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

// ── Skill library ──────────────────────────────────────────────────────────

/** Returns all skills in the company library with active-assignment counts. */
export async function listCompanySkills(
  companyId: string,
): Promise<TeamSkillLibraryItem[]> {
  const skills = await db
    .select({
      id: teamSkills.id,
      name: teamSkills.name,
      category: teamSkills.category,
      description: teamSkills.description,
      isActive: teamSkills.isActive,
      createdAt: teamSkills.createdAt,
      updatedAt: teamSkills.updatedAt,
    })
    .from(teamSkills)
    .where(eq(teamSkills.companyId, companyId))
    .orderBy(teamSkills.name);

  if (skills.length === 0) return [];

  // Fetch active-assignment counts for all skills in one query.
  const countRows = await db
    .select({
      skillId: teamMemberSkills.skillId,
      cnt: sql<number>`cast(count(*) as int)`,
    })
    .from(teamMemberSkills)
    .where(
      and(
        eq(teamMemberSkills.companyId, companyId),
        eq(teamMemberSkills.isActive, true),
      ),
    )
    .groupBy(teamMemberSkills.skillId);

  const countMap: Record<string, number> = {};
  for (const r of countRows) {
    countMap[r.skillId] = r.cnt;
  }

  return skills.map((s) => ({
    ...s,
    memberCount: countMap[s.id] ?? 0,
  }));
}

export interface CreateSkillInput {
  name: string;
  category?: string | null;
  description?: string | null;
}

/**
 * Creates a new skill in the company library.
 * Rejects with a descriptive error when a skill with the same normalized name
 * already exists (active or inactive) for this company.
 */
export async function createSkill(
  companyId: string,
  data: CreateSkillInput,
  createdBy?: string,
): Promise<TeamSkillLibraryItem> {
  const trimmedName = data.name.trim();
  if (!trimmedName) throw new Error("Skill name is required.");

  // Duplicate check (case-insensitive) — DB unique index also enforces this,
  // but checking here gives a user-friendly message instead of a PG error.
  const existing = await db
    .select({ id: teamSkills.id, isActive: teamSkills.isActive })
    .from(teamSkills)
    .where(
      and(
        eq(teamSkills.companyId, companyId),
        eq(sql`LOWER(TRIM(${teamSkills.name}))`, normalizeName(trimmedName)),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    const dup = existing[0]!;
    const hint = dup.isActive ? "" : " (currently inactive — reactivate it instead)";
    throw new Error(`A skill named "${trimmedName}" already exists${hint}.`);
  }

  const [row] = await db
    .insert(teamSkills)
    .values({
      companyId,
      name: trimmedName,
      category: data.category ?? null,
      description: data.description ?? null,
      isActive: true,
      createdBy: createdBy ?? null,
    })
    .returning();

  return { ...row!, memberCount: 0 };
}

export interface UpdateSkillInput {
  name?: string;
  category?: string | null;
  description?: string | null;
  isActive?: boolean;
}

/** Updates skill metadata or active state. Rejects duplicate names. */
export async function updateSkill(
  companyId: string,
  skillId: string,
  data: UpdateSkillInput,
  updatedBy?: string,
): Promise<TeamSkillLibraryItem> {
  const current = await db
    .select()
    .from(teamSkills)
    .where(and(eq(teamSkills.companyId, companyId), eq(teamSkills.id, skillId)))
    .limit(1);

  if (current.length === 0) throw new Error("Skill not found.");

  if (data.name !== undefined) {
    const trimmedName = data.name.trim();
    if (!trimmedName) throw new Error("Skill name is required.");

    const conflict = await db
      .select({ id: teamSkills.id })
      .from(teamSkills)
      .where(
        and(
          eq(teamSkills.companyId, companyId),
          eq(sql`LOWER(TRIM(${teamSkills.name}))`, normalizeName(trimmedName)),
        ),
      )
      .limit(1);

    if (conflict.length > 0 && conflict[0]!.id !== skillId) {
      throw new Error(`A skill named "${trimmedName}" already exists.`);
    }
    data = { ...data, name: trimmedName };
  }

  const [updated] = await db
    .update(teamSkills)
    .set({
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.category !== undefined ? { category: data.category } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      updatedAt: new Date(),
      updatedBy: updatedBy ?? null,
    })
    .where(and(eq(teamSkills.companyId, companyId), eq(teamSkills.id, skillId)))
    .returning();

  // Re-fetch member count for the response.
  const [countRow] = await db
    .select({ cnt: sql<number>`cast(count(*) as int)` })
    .from(teamMemberSkills)
    .where(
      and(
        eq(teamMemberSkills.companyId, companyId),
        eq(teamMemberSkills.skillId, skillId),
        eq(teamMemberSkills.isActive, true),
      ),
    );

  return { ...updated!, memberCount: countRow?.cnt ?? 0 };
}

/**
 * Hard-deletes a skill from the library.
 * Rejected when active member assignments exist — caller should deactivate instead.
 */
export async function deleteSkill(
  companyId: string,
  skillId: string,
): Promise<void> {
  const [countRow] = await db
    .select({ cnt: sql<number>`cast(count(*) as int)` })
    .from(teamMemberSkills)
    .where(
      and(
        eq(teamMemberSkills.companyId, companyId),
        eq(teamMemberSkills.skillId, skillId),
        eq(teamMemberSkills.isActive, true),
      ),
    );

  if ((countRow?.cnt ?? 0) > 0) {
    throw new Error(
      "Cannot delete a skill that is actively assigned to team members. " +
        "Deactivate the skill or remove all assignments first.",
    );
  }

  await db
    .delete(teamSkills)
    .where(and(eq(teamSkills.companyId, companyId), eq(teamSkills.id, skillId)));
}

// ── Member skill assignments ───────────────────────────────────────────────

/** Returns all skill assignments for a member with skill details and expiry status. */
export async function listMemberSkills(
  companyId: string,
  userId: string,
): Promise<TeamMemberSkillRow[]> {
  const rows = await db
    .select({
      id: teamMemberSkills.id,
      skillId: teamMemberSkills.skillId,
      name: teamSkills.name,
      category: teamSkills.category,
      level: teamMemberSkills.level,
      certificationName: teamMemberSkills.certificationName,
      certificationExpiresAt: teamMemberSkills.certificationExpiresAt,
      notes: teamMemberSkills.notes,
      isActive: teamMemberSkills.isActive,
      createdAt: teamMemberSkills.createdAt,
      updatedAt: teamMemberSkills.updatedAt,
    })
    .from(teamMemberSkills)
    .innerJoin(teamSkills, eq(teamMemberSkills.skillId, teamSkills.id))
    .where(
      and(
        eq(teamMemberSkills.companyId, companyId),
        eq(teamMemberSkills.userId, userId),
      ),
    )
    .orderBy(teamSkills.name);

  return rows.map((r) => ({
    ...r,
    level: r.level as SkillLevel,
    expiryStatus: computeExpiryStatus(r.certificationExpiresAt),
  }));
}

export interface AssignSkillInput {
  skillId: string;
  level: SkillLevel;
  certificationName?: string | null;
  certificationExpiresAt?: string | null;
  notes?: string | null;
}

/**
 * Assigns an existing library skill to a member.
 * Rejects when the member already has an active assignment for this skill
 * (update the existing assignment instead).
 */
export async function assignSkill(
  companyId: string,
  userId: string,
  data: AssignSkillInput,
  createdBy?: string,
): Promise<TeamMemberSkillRow> {
  if (!SKILL_LEVELS.includes(data.level)) {
    throw new Error(`Invalid skill level: ${data.level}`);
  }

  // Verify skill belongs to same company.
  const [skill] = await db
    .select({ id: teamSkills.id, name: teamSkills.name, category: teamSkills.category })
    .from(teamSkills)
    .where(and(eq(teamSkills.companyId, companyId), eq(teamSkills.id, data.skillId)))
    .limit(1);

  if (!skill) throw new Error("Skill not found in company library.");

  const existing = await db
    .select({ id: teamMemberSkills.id, isActive: teamMemberSkills.isActive })
    .from(teamMemberSkills)
    .where(
      and(
        eq(teamMemberSkills.companyId, companyId),
        eq(teamMemberSkills.userId, userId),
        eq(teamMemberSkills.skillId, data.skillId),
      ),
    )
    .limit(1);

  if (existing.length > 0 && existing[0]!.isActive) {
    throw new Error(
      "This skill is already assigned to the member. Edit the existing assignment to update it.",
    );
  }

  let row: typeof teamMemberSkills.$inferSelect;

  if (existing.length > 0) {
    // Reactivate and update the inactive assignment.
    const [updated] = await db
      .update(teamMemberSkills)
      .set({
        level: data.level,
        certificationName: data.certificationName ?? null,
        certificationExpiresAt: data.certificationExpiresAt
          ? new Date(data.certificationExpiresAt)
          : null,
        notes: data.notes ?? null,
        isActive: true,
        updatedAt: new Date(),
        updatedBy: createdBy ?? null,
      })
      .where(eq(teamMemberSkills.id, existing[0]!.id))
      .returning();
    row = updated!;
  } else {
    const [inserted] = await db
      .insert(teamMemberSkills)
      .values({
        companyId,
        userId,
        skillId: data.skillId,
        level: data.level,
        certificationName: data.certificationName ?? null,
        certificationExpiresAt: data.certificationExpiresAt
          ? new Date(data.certificationExpiresAt)
          : null,
        notes: data.notes ?? null,
        isActive: true,
        createdBy: createdBy ?? null,
      })
      .returning();
    row = inserted!;
  }

  return {
    id: row.id,
    skillId: row.skillId,
    name: skill.name,
    category: skill.category,
    level: row.level as SkillLevel,
    certificationName: row.certificationName,
    certificationExpiresAt: row.certificationExpiresAt,
    notes: row.notes,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    expiryStatus: computeExpiryStatus(row.certificationExpiresAt),
  };
}

export interface UpdateMemberSkillInput {
  level?: SkillLevel;
  certificationName?: string | null;
  certificationExpiresAt?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

/** Updates a member's skill assignment (level, cert details, active state). */
export async function updateMemberSkill(
  companyId: string,
  memberSkillId: string,
  data: UpdateMemberSkillInput,
  updatedBy?: string,
): Promise<TeamMemberSkillRow> {
  if (data.level !== undefined && !SKILL_LEVELS.includes(data.level)) {
    throw new Error(`Invalid skill level: ${data.level}`);
  }

  const [updated] = await db
    .update(teamMemberSkills)
    .set({
      ...(data.level !== undefined ? { level: data.level } : {}),
      ...(data.certificationName !== undefined
        ? { certificationName: data.certificationName }
        : {}),
      ...(data.certificationExpiresAt !== undefined
        ? {
            certificationExpiresAt: data.certificationExpiresAt
              ? new Date(data.certificationExpiresAt)
              : null,
          }
        : {}),
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      updatedAt: new Date(),
      updatedBy: updatedBy ?? null,
    })
    .where(
      and(
        eq(teamMemberSkills.companyId, companyId),
        eq(teamMemberSkills.id, memberSkillId),
      ),
    )
    .returning();

  if (!updated) throw new Error("Skill assignment not found.");

  const [skill] = await db
    .select({ name: teamSkills.name, category: teamSkills.category })
    .from(teamSkills)
    .where(eq(teamSkills.id, updated.skillId))
    .limit(1);

  return {
    id: updated.id,
    skillId: updated.skillId,
    name: skill?.name ?? "",
    category: skill?.category ?? null,
    level: updated.level as SkillLevel,
    certificationName: updated.certificationName,
    certificationExpiresAt: updated.certificationExpiresAt,
    notes: updated.notes,
    isActive: updated.isActive,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
    expiryStatus: computeExpiryStatus(updated.certificationExpiresAt),
  };
}

/** Removes a member skill assignment (hard delete). */
export async function removeMemberSkill(
  companyId: string,
  memberSkillId: string,
): Promise<void> {
  await db
    .delete(teamMemberSkills)
    .where(
      and(
        eq(teamMemberSkills.companyId, companyId),
        eq(teamMemberSkills.id, memberSkillId),
      ),
    );
}
