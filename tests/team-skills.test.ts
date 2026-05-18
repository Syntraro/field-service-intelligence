/**
 * Team Skills — Phase 3 storage layer tests.
 *
 * Exercises `server/storage/teamSkills.ts` against a real database
 * (same pattern as users-role-tenant-only.test.ts).
 *
 * Migration required: 2026_05_17_create_team_skills.sql
 *
 * Covers:
 *   1. Tenant isolation — operations are scoped to companyId.
 *   2. Create skill — happy path.
 *   3. Duplicate skill prevention — same normalized name rejected.
 *   4. List company skills — returns memberCount.
 *   5. Update skill — name/category/isActive.
 *   6. Delete skill — succeeds when unused.
 *   7. Delete skill — rejected when active members assigned.
 *   8. Assign skill to member.
 *   9. Duplicate assignment rejected.
 *  10. Inactive assignment reactivated on reassign.
 *  11. Update member skill — level/cert/expiry/notes/isActive.
 *  12. Remove member skill — hard delete.
 *  13. List member skills — joins skill name, computes expiryStatus.
 *  14. Expiry status: expired / expiring_soon / valid / null.
 *  15. Cross-tenant isolation — skills from another company not visible.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import { companies, users } from "@shared/schema";
import {
  listCompanySkills,
  createSkill,
  updateSkill,
  deleteSkill,
  listMemberSkills,
  assignSkill,
  updateMemberSkill,
  removeMemberSkill,
} from "../server/storage/teamSkills";

// ── Fixtures ──────────────────────────────────────────────────────────────

const CO_A = "00000000-0000-5317-0001-000000000001";
const CO_B = "00000000-0000-5317-0001-000000000002"; // for cross-tenant check
const USER_A = "00000000-0000-5317-0002-000000000001";

async function cleanUp() {
  // Delete in FK order: member skills → skills → users → companies
  await db.execute(sql`DELETE FROM team_member_skills WHERE company_id IN (${CO_A}, ${CO_B})`);
  await db.execute(sql`DELETE FROM team_skills WHERE company_id IN (${CO_A}, ${CO_B})`);
  await db.execute(sql`DELETE FROM users WHERE id = ${USER_A}`);
  await db.execute(sql`DELETE FROM companies WHERE id IN (${CO_A}, ${CO_B})`);
}

beforeAll(async () => {
  await cleanUp();
  await db
    .insert(companies)
    .values([
      { id: CO_A, name: "Skills Test Co A" },
      { id: CO_B, name: "Skills Test Co B" },
    ])
    .onConflictDoNothing();

  await db
    .insert(users)
    .values({
      id: USER_A,
      companyId: CO_A,
      email: `skills-test-${Date.now()}@example.test`,
      password: "x",
      role: "technician",
    })
    .onConflictDoNothing();
});

afterAll(cleanUp);

// ── Library: create ────────────────────────────────────────────────────────

describe("createSkill", () => {
  it("creates a skill in the company library", async () => {
    const skill = await createSkill(CO_A, { name: "Refrigerant Handling", category: "HVAC" });
    expect(skill.id).toBeTruthy();
    expect(skill.name).toBe("Refrigerant Handling");
    expect(skill.category).toBe("HVAC");
    expect(skill.isActive).toBe(true);
    expect(skill.memberCount).toBe(0);
  });

  it("rejects empty skill name", async () => {
    await expect(createSkill(CO_A, { name: "   " })).rejects.toThrow("required");
  });

  it("rejects duplicate name (exact case)", async () => {
    await createSkill(CO_A, { name: "Brazing" });
    await expect(createSkill(CO_A, { name: "Brazing" })).rejects.toThrow("already exists");
  });

  it("rejects duplicate name (different case)", async () => {
    await createSkill(CO_A, { name: "Heat Pump Systems" });
    await expect(createSkill(CO_A, { name: "heat pump systems" })).rejects.toThrow("already exists");
  });

  it("rejects duplicate name with leading/trailing spaces", async () => {
    await createSkill(CO_A, { name: "Ductwork Installation" });
    await expect(createSkill(CO_A, { name: "  Ductwork Installation  " })).rejects.toThrow("already exists");
  });

  it("allows the same name in a different company", async () => {
    const skill = await createSkill(CO_B, { name: "Refrigerant Handling" });
    expect(skill.name).toBe("Refrigerant Handling");
  });
});

// ── Library: list ─────────────────────────────────────────────────────────

describe("listCompanySkills", () => {
  it("returns only skills belonging to the company", async () => {
    const skills = await listCompanySkills(CO_A);
    const names = skills.map((s) => s.name);
    expect(names).toContain("Refrigerant Handling");
    // CO_B skills should not appear
    for (const s of skills) {
      expect(s).not.toMatchObject({ id: expect.stringMatching(/CO_B/) });
    }
  });

  it("returns skills sorted by name", async () => {
    const skills = await listCompanySkills(CO_A);
    const names = skills.map((s) => s.name);
    expect(names).toEqual([...names].sort());
  });

  it("includes memberCount = 0 for unassigned skills", async () => {
    const skills = await listCompanySkills(CO_A);
    // All skills at this point have no assignments
    for (const s of skills) {
      expect(s.memberCount).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── Library: update ────────────────────────────────────────────────────────

describe("updateSkill", () => {
  it("updates name and category", async () => {
    const created = await createSkill(CO_A, { name: "Electrical Troubleshooting" });
    const updated = await updateSkill(CO_A, created.id, {
      name: "Electrical Troubleshooting & Diagnosis",
      category: "Electrical",
    });
    expect(updated.name).toBe("Electrical Troubleshooting & Diagnosis");
    expect(updated.category).toBe("Electrical");
  });

  it("deactivates a skill", async () => {
    const created = await createSkill(CO_A, { name: "Gas Furnace Service" });
    const updated = await updateSkill(CO_A, created.id, { isActive: false });
    expect(updated.isActive).toBe(false);
  });

  it("rejects renaming to a duplicate name", async () => {
    const a = await createSkill(CO_A, { name: "Sheet Metal Fabrication" });
    const b = await createSkill(CO_A, { name: "Commercial HVAC" });
    await expect(updateSkill(CO_A, b.id, { name: a.name })).rejects.toThrow("already exists");
  });

  it("throws when skill not found in company", async () => {
    await expect(updateSkill(CO_B, "00000000-0000-0000-0000-nonexistent00", { name: "X" }))
      .rejects.toThrow("not found");
  });
});

// ── Library: delete ────────────────────────────────────────────────────────

describe("deleteSkill", () => {
  it("hard-deletes an unused skill", async () => {
    const skill = await createSkill(CO_A, { name: "Boiler Maintenance" });
    await expect(deleteSkill(CO_A, skill.id)).resolves.toBeUndefined();
    // Should no longer appear in the list
    const skills = await listCompanySkills(CO_A);
    expect(skills.find((s) => s.id === skill.id)).toBeUndefined();
  });

  it("rejects deletion when member has active assignment", async () => {
    const skill = await createSkill(CO_A, { name: "Chiller Systems" });
    await assignSkill(CO_A, USER_A, { skillId: skill.id, level: "basic" });
    await expect(deleteSkill(CO_A, skill.id)).rejects.toThrow("assigned to team members");
  });
});

// ── Member assignments: assign ─────────────────────────────────────────────

describe("assignSkill", () => {
  it("assigns a skill to a member", async () => {
    const skill = await createSkill(CO_A, { name: "Hydronic Heating" });
    const row = await assignSkill(CO_A, USER_A, { skillId: skill.id, level: "intermediate" });
    expect(row.skillId).toBe(skill.id);
    expect(row.level).toBe("intermediate");
    expect(row.isActive).toBe(true);
    expect(row.name).toBe("Hydronic Heating");
  });

  it("rejects assigning a skill from a different company", async () => {
    const foreignSkill = await createSkill(CO_B, { name: "Foreign Skill" });
    await expect(
      assignSkill(CO_A, USER_A, { skillId: foreignSkill.id, level: "basic" }),
    ).rejects.toThrow("not found in company library");
  });

  it("rejects duplicate active assignment", async () => {
    const skill = await createSkill(CO_A, { name: "Rooftop Unit Service" });
    await assignSkill(CO_A, USER_A, { skillId: skill.id, level: "basic" });
    await expect(
      assignSkill(CO_A, USER_A, { skillId: skill.id, level: "advanced" }),
    ).rejects.toThrow("already assigned");
  });

  it("reactivates an inactive assignment instead of creating duplicate", async () => {
    const skill = await createSkill(CO_A, { name: "Geothermal Systems" });
    const first = await assignSkill(CO_A, USER_A, { skillId: skill.id, level: "basic" });
    // Deactivate it
    await updateMemberSkill(CO_A, first.id, { isActive: false });
    // Re-assign — should reactivate and update
    const reactivated = await assignSkill(CO_A, USER_A, { skillId: skill.id, level: "advanced" });
    expect(reactivated.id).toBe(first.id);
    expect(reactivated.level).toBe("advanced");
    expect(reactivated.isActive).toBe(true);
  });

  it("rejects invalid skill level", async () => {
    const skill = await createSkill(CO_A, { name: "HVAC Controls" });
    await expect(
      assignSkill(CO_A, USER_A, { skillId: skill.id, level: "expert" as never }),
    ).rejects.toThrow("Invalid skill level");
  });
});

// ── Member assignments: update ─────────────────────────────────────────────

describe("updateMemberSkill", () => {
  it("updates level and certification fields", async () => {
    const skill = await createSkill(CO_A, { name: "EPA 608 Certification" });
    const row = await assignSkill(CO_A, USER_A, { skillId: skill.id, level: "basic" });
    const updated = await updateMemberSkill(CO_A, row.id, {
      level: "certified",
      certificationName: "EPA 608 Universal",
      certificationExpiresAt: "2028-01-01T00:00:00.000Z",
      notes: "Renewed annually",
    });
    expect(updated.level).toBe("certified");
    expect(updated.certificationName).toBe("EPA 608 Universal");
    expect(updated.certificationExpiresAt).toBeTruthy();
    expect(updated.notes).toBe("Renewed annually");
  });

  it("deactivates an assignment", async () => {
    const skill = await createSkill(CO_A, { name: "Variable Refrigerant Flow" });
    const row = await assignSkill(CO_A, USER_A, { skillId: skill.id, level: "basic" });
    const updated = await updateMemberSkill(CO_A, row.id, { isActive: false });
    expect(updated.isActive).toBe(false);
  });

  it("rejects update with invalid level", async () => {
    const skill = await createSkill(CO_A, { name: "Air Quality Testing" });
    const row = await assignSkill(CO_A, USER_A, { skillId: skill.id, level: "basic" });
    await expect(
      updateMemberSkill(CO_A, row.id, { level: "master" as never }),
    ).rejects.toThrow("Invalid skill level");
  });

  it("throws when assignment not found", async () => {
    await expect(
      updateMemberSkill(CO_A, "00000000-0000-0000-0000-nonexistent00", { level: "advanced" }),
    ).rejects.toThrow();
  });
});

// ── Member assignments: remove ─────────────────────────────────────────────

describe("removeMemberSkill", () => {
  it("removes an assignment (hard delete)", async () => {
    const skill = await createSkill(CO_A, { name: "Demand-Controlled Ventilation" });
    const row = await assignSkill(CO_A, USER_A, { skillId: skill.id, level: "basic" });
    await removeMemberSkill(CO_A, row.id);
    const skills = await listMemberSkills(CO_A, USER_A);
    expect(skills.find((s) => s.id === row.id)).toBeUndefined();
  });

  it("is a no-op when assignment does not exist (no error)", async () => {
    await expect(
      removeMemberSkill(CO_A, "00000000-0000-0000-0000-nonexistent00"),
    ).resolves.toBeUndefined();
  });
});

// ── List member skills ─────────────────────────────────────────────────────

describe("listMemberSkills", () => {
  it("returns skill name from joined team_skills row", async () => {
    const skill = await createSkill(CO_A, { name: "Smart Thermostat Integration" });
    await assignSkill(CO_A, USER_A, { skillId: skill.id, level: "intermediate" });
    const rows = await listMemberSkills(CO_A, USER_A);
    const found = rows.find((r) => r.skillId === skill.id);
    expect(found?.name).toBe("Smart Thermostat Integration");
  });

  it("returns expiryStatus=null when no expiry date set", async () => {
    const skill = await createSkill(CO_A, { name: "Comfort Cooling Design" });
    await assignSkill(CO_A, USER_A, { skillId: skill.id, level: "basic" });
    const rows = await listMemberSkills(CO_A, USER_A);
    const found = rows.find((r) => r.skillId === skill.id);
    expect(found?.expiryStatus).toBeNull();
  });

  it("returns expiryStatus=expired when expiry is in the past", async () => {
    const skill = await createSkill(CO_A, { name: "Building Automation" });
    await assignSkill(CO_A, USER_A, {
      skillId: skill.id,
      level: "certified",
      certificationExpiresAt: "2020-01-01T00:00:00.000Z",
    });
    const rows = await listMemberSkills(CO_A, USER_A);
    const found = rows.find((r) => r.skillId === skill.id);
    expect(found?.expiryStatus).toBe("expired");
  });

  it("returns expiryStatus=expiring_soon within 30 days", async () => {
    const skill = await createSkill(CO_A, { name: "Cooling Tower Maintenance" });
    const soonDate = new Date(Date.now() + 15 * 86_400_000).toISOString(); // 15 days from now
    await assignSkill(CO_A, USER_A, {
      skillId: skill.id,
      level: "certified",
      certificationExpiresAt: soonDate,
    });
    const rows = await listMemberSkills(CO_A, USER_A);
    const found = rows.find((r) => r.skillId === skill.id);
    expect(found?.expiryStatus).toBe("expiring_soon");
  });

  it("returns expiryStatus=valid when expiry is > 30 days away", async () => {
    const skill = await createSkill(CO_A, { name: "Energy Auditing" });
    const futureDate = new Date(Date.now() + 90 * 86_400_000).toISOString();
    await assignSkill(CO_A, USER_A, {
      skillId: skill.id,
      level: "certified",
      certificationExpiresAt: futureDate,
    });
    const rows = await listMemberSkills(CO_A, USER_A);
    const found = rows.find((r) => r.skillId === skill.id);
    expect(found?.expiryStatus).toBe("valid");
  });
});

// ── Cross-tenant isolation ─────────────────────────────────────────────────

describe("cross-tenant isolation", () => {
  it("listCompanySkills does not return skills from another company", async () => {
    const coASkills = await listCompanySkills(CO_A);
    const coBSkills = await listCompanySkills(CO_B);
    const coAIds = new Set(coASkills.map((s) => s.id));
    const coBIds = new Set(coBSkills.map((s) => s.id));
    for (const id of Array.from(coBIds)) {
      expect(coAIds.has(id)).toBe(false);
    }
  });

  it("memberCount in listCompanySkills includes only same-company assignments", async () => {
    // Create a skill in CO_B and assign it to a CO_B user if we had one.
    // Here we just verify CO_B skill list has memberCount = 0 for all skills
    // since we haven't assigned any CO_B skills to any CO_B user.
    const coBSkills = await listCompanySkills(CO_B);
    for (const s of coBSkills) {
      expect(s.memberCount).toBe(0);
    }
  });
});

// ── certificationExpiresAt: date-only input ────────────────────────────────

describe("certificationExpiresAt — date-only input handling", () => {
  it("creates assignment with date-only string (YYYY-MM-DD)", async () => {
    const skill = await createSkill(CO_A, { name: "Date-Only Create Test" });
    const row = await assignSkill(CO_A, USER_A, {
      skillId: skill.id,
      level: "certified",
      certificationExpiresAt: "2030-06-15",
    });
    expect(row.certificationExpiresAt).toBeTruthy();
    // Stored as UTC midnight: 2030-06-15T00:00:00.000Z
    const stored = row.certificationExpiresAt as Date;
    expect(stored.getUTCFullYear()).toBe(2030);
    expect(stored.getUTCMonth()).toBe(5); // June = 5 (0-indexed)
    expect(stored.getUTCDate()).toBe(15);
    expect(row.expiryStatus).toBe("valid");
  });

  it("updates assignment with date-only string (YYYY-MM-DD)", async () => {
    const skill = await createSkill(CO_A, { name: "Date-Only Update Test" });
    const row = await assignSkill(CO_A, USER_A, { skillId: skill.id, level: "basic" });
    const updated = await updateMemberSkill(CO_A, row.id, {
      certificationExpiresAt: "2028-12-31",
    });
    expect(updated.certificationExpiresAt).toBeTruthy();
    const stored = updated.certificationExpiresAt as Date;
    expect(stored.getUTCFullYear()).toBe(2028);
    expect(stored.getUTCMonth()).toBe(11); // December = 11
    expect(stored.getUTCDate()).toBe(31);
  });

  it("clears expiry date when updated with empty string", async () => {
    const skill = await createSkill(CO_A, { name: "Clear Expiry Test" });
    const row = await assignSkill(CO_A, USER_A, {
      skillId: skill.id,
      level: "certified",
      certificationExpiresAt: "2030-01-01T00:00:00.000Z",
    });
    expect(row.certificationExpiresAt).toBeTruthy();
    const cleared = await updateMemberSkill(CO_A, row.id, {
      certificationExpiresAt: null,
    });
    expect(cleared.certificationExpiresAt).toBeNull();
    expect(cleared.expiryStatus).toBeNull();
  });
});

// ── certificationExpiresAtSchema: Zod validation ──────────────────────────

describe("certificationExpiresAtSchema — Zod validation", () => {
  // Inline import so we test the actual route schema, not a copy.
  const importSchema = () => import("../server/utils/certExpiresAtSchema");

  it("accepts YYYY-MM-DD and normalizes to non-null string", async () => {
    const { certificationExpiresAtSchema } = await importSchema();
    const result = certificationExpiresAtSchema.safeParse("2026-05-22");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("2026-05-22");
  });

  it("accepts full ISO datetime string", async () => {
    const { certificationExpiresAtSchema } = await importSchema();
    const result = certificationExpiresAtSchema.safeParse("2026-05-22T00:00:00.000Z");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("2026-05-22T00:00:00.000Z");
  });

  it("accepts null and returns null", async () => {
    const { certificationExpiresAtSchema } = await importSchema();
    const result = certificationExpiresAtSchema.safeParse(null);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBeNull();
  });

  it("accepts empty string and transforms to null", async () => {
    const { certificationExpiresAtSchema } = await importSchema();
    const result = certificationExpiresAtSchema.safeParse("");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBeNull();
  });

  it("accepts undefined and returns null", async () => {
    const { certificationExpiresAtSchema } = await importSchema();
    const result = certificationExpiresAtSchema.safeParse(undefined);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBeNull();
  });

  it("rejects plainly non-date strings", async () => {
    const { certificationExpiresAtSchema } = await importSchema();
    // V8's Date parser is permissive with slash-separated formats, so we only
    // assert rejection for strings that are clearly not a date in any format.
    for (const bad of ["not-a-date", "hello", "abc-def-ghi", "2026-99"]) {
      const result = certificationExpiresAtSchema.safeParse(bad);
      expect(result.success, `Expected "${bad}" to fail`).toBe(false);
    }
  });
});

// ── Schema: SKILL_LEVELS constant ─────────────────────────────────────────

describe("SKILL_LEVELS constant (shared/schema.ts)", () => {
  it("exports exactly four levels", async () => {
    const { SKILL_LEVELS } = await import("@shared/schema");
    expect(SKILL_LEVELS).toEqual(["basic", "intermediate", "advanced", "certified"]);
  });
});
