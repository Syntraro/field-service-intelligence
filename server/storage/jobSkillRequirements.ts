/**
 * Job skill requirements — CRUD for job_required_skills and
 * job_template_required_skills.
 *
 * All queries are company-scoped. The system never auto-blocks assignment
 * based on requirements — these are guidance only.
 */

import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { jobRequiredSkills, jobTemplateRequiredSkills, teamSkills, SKILL_LEVELS } from "@shared/schema";
import type { SkillLevel } from "@shared/schema";

// ── Public shapes ──────────────────────────────────────────────────────────

export interface JobRequiredSkillRow {
  id: string;
  jobId: string;
  skillId: string;
  skillName: string;
  skillCategory: string | null;
  minimumLevel: SkillLevel | null;
  required: boolean;
  createdAt: Date;
}

export interface TemplateRequiredSkillRow {
  id: string;
  templateId: string;
  skillId: string;
  skillName: string;
  skillCategory: string | null;
  minimumLevel: SkillLevel | null;
  required: boolean;
  createdAt: Date;
}

// ── Job required skills ────────────────────────────────────────────────────

export async function listJobRequiredSkills(
  companyId: string,
  jobId: string,
): Promise<JobRequiredSkillRow[]> {
  const rows = await db
    .select({
      id: jobRequiredSkills.id,
      jobId: jobRequiredSkills.jobId,
      skillId: jobRequiredSkills.skillId,
      skillName: teamSkills.name,
      skillCategory: teamSkills.category,
      minimumLevel: jobRequiredSkills.minimumLevel,
      required: jobRequiredSkills.required,
      createdAt: jobRequiredSkills.createdAt,
    })
    .from(jobRequiredSkills)
    .innerJoin(teamSkills, eq(jobRequiredSkills.skillId, teamSkills.id))
    .where(
      and(
        eq(jobRequiredSkills.companyId, companyId),
        eq(jobRequiredSkills.jobId, jobId),
      ),
    )
    .orderBy(teamSkills.name);

  return rows.map((r) => ({
    ...r,
    minimumLevel: r.minimumLevel as SkillLevel | null,
  }));
}

export interface AddJobSkillRequirementInput {
  skillId: string;
  minimumLevel?: SkillLevel | null;
  required?: boolean;
}

export async function addJobSkillRequirement(
  companyId: string,
  jobId: string,
  data: AddJobSkillRequirementInput,
): Promise<JobRequiredSkillRow> {
  if (data.minimumLevel && !SKILL_LEVELS.includes(data.minimumLevel)) {
    throw new Error(`Invalid minimum level: ${data.minimumLevel}`);
  }

  // Verify skill belongs to company.
  const [skill] = await db
    .select({ id: teamSkills.id, name: teamSkills.name, category: teamSkills.category })
    .from(teamSkills)
    .where(and(eq(teamSkills.companyId, companyId), eq(teamSkills.id, data.skillId)))
    .limit(1);

  if (!skill) throw new Error("Skill not found in company library.");

  // Upsert: if already exists, update it.
  const existing = await db
    .select({ id: jobRequiredSkills.id })
    .from(jobRequiredSkills)
    .where(
      and(
        eq(jobRequiredSkills.companyId, companyId),
        eq(jobRequiredSkills.jobId, jobId),
        eq(jobRequiredSkills.skillId, data.skillId),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    const [updated] = await db
      .update(jobRequiredSkills)
      .set({
        minimumLevel: data.minimumLevel ?? null,
        required: data.required ?? true,
        updatedAt: new Date(),
      })
      .where(eq(jobRequiredSkills.id, existing[0]!.id))
      .returning();
    return {
      id: updated!.id,
      jobId: updated!.jobId,
      skillId: updated!.skillId,
      skillName: skill.name,
      skillCategory: skill.category,
      minimumLevel: updated!.minimumLevel as SkillLevel | null,
      required: updated!.required,
      createdAt: updated!.createdAt,
    };
  }

  const [inserted] = await db
    .insert(jobRequiredSkills)
    .values({
      companyId,
      jobId,
      skillId: data.skillId,
      minimumLevel: data.minimumLevel ?? null,
      required: data.required ?? true,
    })
    .returning();

  return {
    id: inserted!.id,
    jobId: inserted!.jobId,
    skillId: inserted!.skillId,
    skillName: skill.name,
    skillCategory: skill.category,
    minimumLevel: inserted!.minimumLevel as SkillLevel | null,
    required: inserted!.required,
    createdAt: inserted!.createdAt,
  };
}

export interface UpdateJobSkillRequirementInput {
  minimumLevel?: SkillLevel | null;
  required?: boolean;
}

export async function updateJobSkillRequirement(
  companyId: string,
  requirementId: string,
  data: UpdateJobSkillRequirementInput,
): Promise<JobRequiredSkillRow> {
  if (data.minimumLevel && !SKILL_LEVELS.includes(data.minimumLevel)) {
    throw new Error(`Invalid minimum level: ${data.minimumLevel}`);
  }

  const [updated] = await db
    .update(jobRequiredSkills)
    .set({
      ...(data.minimumLevel !== undefined ? { minimumLevel: data.minimumLevel } : {}),
      ...(data.required !== undefined ? { required: data.required } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(jobRequiredSkills.companyId, companyId),
        eq(jobRequiredSkills.id, requirementId),
      ),
    )
    .returning();

  if (!updated) throw new Error("Skill requirement not found.");

  const [skill] = await db
    .select({ name: teamSkills.name, category: teamSkills.category })
    .from(teamSkills)
    .where(eq(teamSkills.id, updated.skillId))
    .limit(1);

  return {
    id: updated.id,
    jobId: updated.jobId,
    skillId: updated.skillId,
    skillName: skill?.name ?? "",
    skillCategory: skill?.category ?? null,
    minimumLevel: updated.minimumLevel as SkillLevel | null,
    required: updated.required,
    createdAt: updated.createdAt,
  };
}

export async function removeJobSkillRequirement(
  companyId: string,
  requirementId: string,
): Promise<void> {
  await db
    .delete(jobRequiredSkills)
    .where(
      and(
        eq(jobRequiredSkills.companyId, companyId),
        eq(jobRequiredSkills.id, requirementId),
      ),
    );
}

// ── Template required skills ───────────────────────────────────────────────

export async function listTemplateRequiredSkills(
  companyId: string,
  templateId: string,
): Promise<TemplateRequiredSkillRow[]> {
  const rows = await db
    .select({
      id: jobTemplateRequiredSkills.id,
      templateId: jobTemplateRequiredSkills.templateId,
      skillId: jobTemplateRequiredSkills.skillId,
      skillName: teamSkills.name,
      skillCategory: teamSkills.category,
      minimumLevel: jobTemplateRequiredSkills.minimumLevel,
      required: jobTemplateRequiredSkills.required,
      createdAt: jobTemplateRequiredSkills.createdAt,
    })
    .from(jobTemplateRequiredSkills)
    .innerJoin(teamSkills, eq(jobTemplateRequiredSkills.skillId, teamSkills.id))
    .where(
      and(
        eq(jobTemplateRequiredSkills.companyId, companyId),
        eq(jobTemplateRequiredSkills.templateId, templateId),
      ),
    )
    .orderBy(teamSkills.name);

  return rows.map((r) => ({
    ...r,
    minimumLevel: r.minimumLevel as SkillLevel | null,
  }));
}

export async function addTemplateSkillRequirement(
  companyId: string,
  templateId: string,
  data: AddJobSkillRequirementInput,
): Promise<TemplateRequiredSkillRow> {
  if (data.minimumLevel && !SKILL_LEVELS.includes(data.minimumLevel)) {
    throw new Error(`Invalid minimum level: ${data.minimumLevel}`);
  }

  const [skill] = await db
    .select({ id: teamSkills.id, name: teamSkills.name, category: teamSkills.category })
    .from(teamSkills)
    .where(and(eq(teamSkills.companyId, companyId), eq(teamSkills.id, data.skillId)))
    .limit(1);

  if (!skill) throw new Error("Skill not found in company library.");

  const existing = await db
    .select({ id: jobTemplateRequiredSkills.id })
    .from(jobTemplateRequiredSkills)
    .where(
      and(
        eq(jobTemplateRequiredSkills.companyId, companyId),
        eq(jobTemplateRequiredSkills.templateId, templateId),
        eq(jobTemplateRequiredSkills.skillId, data.skillId),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    const [updated] = await db
      .update(jobTemplateRequiredSkills)
      .set({
        minimumLevel: data.minimumLevel ?? null,
        required: data.required ?? true,
        updatedAt: new Date(),
      })
      .where(eq(jobTemplateRequiredSkills.id, existing[0]!.id))
      .returning();
    return {
      id: updated!.id,
      templateId: updated!.templateId,
      skillId: updated!.skillId,
      skillName: skill.name,
      skillCategory: skill.category,
      minimumLevel: updated!.minimumLevel as SkillLevel | null,
      required: updated!.required,
      createdAt: updated!.createdAt,
    };
  }

  const [inserted] = await db
    .insert(jobTemplateRequiredSkills)
    .values({
      companyId,
      templateId,
      skillId: data.skillId,
      minimumLevel: data.minimumLevel ?? null,
      required: data.required ?? true,
    })
    .returning();

  return {
    id: inserted!.id,
    templateId: inserted!.templateId,
    skillId: inserted!.skillId,
    skillName: skill.name,
    skillCategory: skill.category,
    minimumLevel: inserted!.minimumLevel as SkillLevel | null,
    required: inserted!.required,
    createdAt: inserted!.createdAt,
  };
}

export async function removeTemplateSkillRequirement(
  companyId: string,
  requirementId: string,
): Promise<void> {
  await db
    .delete(jobTemplateRequiredSkills)
    .where(
      and(
        eq(jobTemplateRequiredSkills.companyId, companyId),
        eq(jobTemplateRequiredSkills.id, requirementId),
      ),
    );
}
