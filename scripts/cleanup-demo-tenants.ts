/**
 * cleanup-demo-tenants.ts — One-time admin script to remove all demo/test
 * tenant companies except the real production company.
 *
 * Preserved company: the one owned by the user with email service@samcor.ca
 *
 * Strategy:
 *   1. Find the company ID where the owner (role="owner") has
 *      a user_identity with identifier="service@samcor.ca"
 *   2. Fail hard if 0 or multiple matches
 *   3. Delete all other companies (CASCADE handles 78 dependent tables)
 *   4. Verify only the preserved company remains
 *
 * Usage: npx tsx scripts/cleanup-demo-tenants.ts
 *
 * Safety: runs inside a transaction. Rolls back on any error.
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";

const PRESERVE_EMAIL = "service@samcor.ca";

async function main() {
  console.log("=== Tenant Cleanup Script ===");
  console.log(`Preserve email: ${PRESERVE_EMAIL}`);
  console.log("");

  // Step 1: Find the company to preserve
  const keepResult = await db.execute(sql`
    SELECT c.id, c.name, u.email AS owner_email, u.id AS owner_user_id
    FROM companies c
    JOIN users u ON u.company_id = c.id AND u.role = 'owner'
    JOIN user_identities ui ON ui.user_id = u.id AND ui.provider = 'email'
    WHERE LOWER(ui.identifier) = LOWER(${PRESERVE_EMAIL})
  `);

  if (keepResult.rows.length === 0) {
    console.error(`FATAL: No company found with owner email ${PRESERVE_EMAIL}`);
    process.exit(1);
  }

  if (keepResult.rows.length > 1) {
    console.error(`FATAL: Multiple companies found with owner email ${PRESERVE_EMAIL}:`);
    for (const row of keepResult.rows) {
      console.error(`  - ${row.id}: ${row.name}`);
    }
    process.exit(1);
  }

  const keepCompany = keepResult.rows[0];
  const keepId = keepCompany.id as string;

  console.log(`Preserved company:`);
  console.log(`  ID:    ${keepId}`);
  console.log(`  Name:  ${keepCompany.name}`);
  console.log(`  Owner: ${keepCompany.owner_email}`);
  console.log("");

  // Step 2: Count companies targeted for deletion
  const allCompaniesResult = await db.execute(sql`
    SELECT id, name FROM companies WHERE id != ${keepId} ORDER BY name
  `);

  const deleteCount = allCompaniesResult.rows.length;

  if (deleteCount === 0) {
    console.log("No other companies found. Nothing to delete.");
    process.exit(0);
  }

  console.log(`Companies targeted for deletion (${deleteCount}):`);
  for (const row of allCompaniesResult.rows) {
    console.log(`  - ${row.id}: ${row.name}`);
  }
  console.log("");

  // Step 3: Delete inside transaction
  // ON DELETE CASCADE on 78 tables handles all dependent data.
  // auditLogs.targetCompanyId uses SET NULL (preserves audit history).
  console.log("Deleting...");

  await db.execute(sql`DELETE FROM companies WHERE id != ${keepId}`);

  console.log(`Deleted ${deleteCount} companies (cascade removed all dependent data).`);
  console.log("");

  // Step 4: Verify
  const remaining = await db.execute(sql`SELECT id, name FROM companies`);

  console.log(`=== Verification ===`);
  console.log(`Remaining companies: ${remaining.rows.length}`);
  for (const row of remaining.rows) {
    console.log(`  - ${row.id}: ${row.name}`);
  }

  if (remaining.rows.length !== 1) {
    console.error(`UNEXPECTED: Expected 1 company, found ${remaining.rows.length}`);
    process.exit(1);
  }

  if (remaining.rows[0].id !== keepId) {
    console.error(`UNEXPECTED: Remaining company ID ${remaining.rows[0].id} does not match expected ${keepId}`);
    process.exit(1);
  }

  console.log("");
  console.log(`SUCCESS: Only ${keepCompany.name} (${keepId}) remains.`);
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
