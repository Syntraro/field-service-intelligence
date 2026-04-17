/**
 * Simulates the new primary-contact selection if company_settings.userId
 * were NOT present — proves the hierarchy tiers 2-6 still pick a sane
 * candidate for Samcor (the real owner, not pmtest@test.com).
 */
import { db } from "../server/db";
import { users } from "../shared/schema";
import { sql, and, eq, isNull, inArray } from "drizzle-orm";

async function main() {
  const companyId = "617dac31-2c3d-49f7-bc49-6b1bfedd37d4";

  const TEST_PATTERN = sql`(
    ${users.email} ILIKE '%@test.%'
    OR ${users.email} ILIKE '%@example.%'
    OR ${users.email} ILIKE 'test%@%'
    OR ${users.email} ILIKE '%+test@%'
  )`;

  // Same ORDER BY as the real query, but with settingsUserId = null.
  const rows = await db
    .select({
      email: users.email,
      role: users.role,
      fullName: users.fullName,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(and(
      eq(users.companyId, companyId),
      isNull(users.deletedAt),
      eq(users.disabled, false),
      eq(users.status, "active"),
      inArray(users.role, ["owner", "admin"]),
    ))
    .orderBy(
      sql`CASE WHEN ${users.id} = ${null} THEN 0 ELSE 1 END`,
      sql`CASE ${users.role} WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END`,
      sql`CASE WHEN ${TEST_PATTERN} THEN 1 ELSE 0 END`,
      sql`CASE WHEN ${users.fullName} IS NOT NULL OR ${users.firstName} IS NOT NULL OR ${users.lastName} IS NOT NULL THEN 0 ELSE 1 END`,
      users.createdAt,
      sql`${users.lastLoginAt} DESC NULLS LAST`,
    );

  console.log("Ranking without settings anchor (Samcor):");
  console.table(rows);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(99); });
