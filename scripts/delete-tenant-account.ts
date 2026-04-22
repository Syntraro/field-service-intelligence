/**
 * delete-tenant-account — FULL tenant account deletion.
 *
 * Scope: every row tied to the single tenant present in the database
 * (one companies row). Runs only when exactly ONE tenant exists — if
 * multiple tenants are present the script refuses with an error; you
 * must then specify which tenant by id (env `TENANT_ID`) to avoid
 * cross-tenant damage.
 *
 * Deletions (FK-safe order, single transaction):
 *   1. user_identities          (child of users)
 *   2. password_reset_tokens    (child of users)
 *   3. session                  (pg session store; all rows — sessions
 *                                in a single-tenant DB are all this tenant's)
 *   4. users                    (child of companies)
 *   5. companies                (tenant root)
 *
 * Everything else the tenant owns (jobs, invoices, clients, settings,
 * subscriptions, etc.) is expected to be empty already from prior
 * resetBusinessData passes — the script still tolerates residue because
 * `companies.id` is referenced `ON DELETE CASCADE` by tenant-scoped
 * children, so the final DELETE FROM companies cleans up whatever
 * survived.
 *
 * Safety guardrails:
 *   - NODE_ENV must not be "production"
 *   - RESET_TENANT_DATA=true must be set
 */

import { sql } from "drizzle-orm";
import { db } from "../server/db";

if (process.env.NODE_ENV === "production") {
  console.error("FATAL: delete-tenant-account cannot run in production.");
  process.exit(1);
}
if (process.env.RESET_TENANT_DATA !== "true") {
  console.error(
    "FATAL: Set RESET_TENANT_DATA=true to confirm FULL tenant deletion.\n" +
    "Usage: RESET_TENANT_DATA=true npx tsx --env-file=.env scripts/delete-tenant-account.ts",
  );
  process.exit(1);
}

type Row<T> = { rows: T[] } | T[];
function rowsOf<T>(result: Row<T>): T[] {
  return (result as any).rows ?? (result as any);
}

async function main() {
  // ── Tenant resolution ────────────────────────────────────────────────
  const tenantIdOverride = process.env.TENANT_ID?.trim();
  let tenantRow: { id: string; name: string | null } | undefined;

  if (tenantIdOverride) {
    const r = await db.execute<{ id: string; name: string | null }>(
      sql`SELECT id, name FROM companies WHERE id = ${tenantIdOverride}`,
    );
    tenantRow = rowsOf(r as any)[0];
    if (!tenantRow) {
      console.error(`FATAL: TENANT_ID=${tenantIdOverride} not found.`);
      process.exit(1);
    }
  } else {
    const all = await db.execute<{ id: string; name: string | null }>(
      sql`SELECT id, name FROM companies`,
    );
    const list = rowsOf(all as any);
    if (list.length === 0) {
      console.log("No companies rows — nothing to delete.");
      process.exit(0);
    }
    if (list.length > 1) {
      console.error(
        `FATAL: ${list.length} tenants found. Refusing to delete ambiguously.\n` +
        `Set TENANT_ID=<id> explicitly.\n` +
        list.map((c) => `  - ${c.id}  ${c.name ?? "(unnamed)"}`).join("\n"),
      );
      process.exit(1);
    }
    tenantRow = list[0];
  }

  const tenantId = tenantRow.id;
  console.log(`Deleting tenant: "${tenantRow.name ?? "(unnamed)"}" (${tenantId})`);

  // ── Collect emails for the report ────────────────────────────────────
  const usersBefore = await db.execute<{ id: string; email: string | null }>(
    sql`SELECT id, email FROM users WHERE company_id = ${tenantId}`,
  );
  const usersList = rowsOf(usersBefore as any);
  const userIds = usersList.map((u) => u.id);
  const userEmails = usersList.map((u) => u.email).filter((e): e is string => !!e);
  console.log(`  Users attached: ${usersList.length}`);
  for (const u of usersList) console.log(`    - ${u.email ?? "(no email)"}`);

  // ── Deletion transaction ─────────────────────────────────────────────
  const deletedCounts: Record<string, number> = {};
  const runDelete = async (label: string, query: any) => {
    const result: any = await db.execute(query);
    const count = result?.rowCount ?? result?.rows?.length ?? 0;
    deletedCounts[label] = count;
    console.log(`  DELETE ${label}: ${count} rows`);
  };

  await db.execute(sql`BEGIN`);
  try {
    // 1. user_identities — child of users
    if (userIds.length > 0) {
      await runDelete(
        "user_identities",
        sql`DELETE FROM user_identities WHERE user_id IN (SELECT id FROM users WHERE company_id = ${tenantId})`,
      );
    }

    // 2. password_reset_tokens — child of users (table may not carry user FK
    //    strictly; delete any rows referencing the tenant's users)
    try {
      await runDelete(
        "password_reset_tokens",
        sql`DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM users WHERE company_id = ${tenantId})`,
      );
    } catch (err: any) {
      // Column may not exist on older schemas — non-fatal.
      console.log(`  SKIP password_reset_tokens: ${err.message}`);
    }

    // 3. session — postgres session store. In a single-tenant DB every
    //    active session is for this tenant; clear the whole table so any
    //    live login is invalidated.
    try {
      await runDelete("session", sql`DELETE FROM session`);
    } catch (err: any) {
      console.log(`  SKIP session: ${err.message}`);
    }

    // 4. users — removes login accounts for this tenant
    await runDelete(
      "users",
      sql`DELETE FROM users WHERE company_id = ${tenantId}`,
    );

    // 5. companies — tenant root. Any surviving tenant-scoped rows with
    //    `ON DELETE CASCADE` on company_id are cleaned up here.
    await runDelete(
      "companies",
      sql`DELETE FROM companies WHERE id = ${tenantId}`,
    );

    await db.execute(sql`COMMIT`);
    console.log("\nTransaction committed.");
  } catch (err) {
    await db.execute(sql`ROLLBACK`);
    console.error("\nTransaction ROLLED BACK:", err);
    process.exit(1);
  }

  // ── Verification ─────────────────────────────────────────────────────
  console.log("\n=== POST-DELETION VERIFICATION ===");

  const companyCheck = await db.execute<{ cnt: string }>(
    sql`SELECT COUNT(*)::text AS cnt FROM companies WHERE id = ${tenantId}`,
  );
  const companyCount = Number(rowsOf(companyCheck as any)[0]?.cnt ?? "0");
  console.log(`  companies[id=${tenantId.slice(0, 8)}…]    = ${companyCount}`);

  let allUsersByEmail = 0;
  for (const email of userEmails) {
    const r = await db.execute<{ cnt: string }>(
      sql`SELECT COUNT(*)::text AS cnt FROM users WHERE lower(email) = lower(${email})`,
    );
    const c = Number(rowsOf(r as any)[0]?.cnt ?? "0");
    console.log(`  users[email=${email}] = ${c}  ${c === 0 ? "(free for signup)" : "*** NOT FREE ***"}`);
    allUsersByEmail += c;
  }

  let identitiesCount = 0;
  if (userIds.length > 0) {
    const placeholders = sql.join(
      userIds.map((id) => sql`${id}`),
      sql`, `,
    );
    const identitiesCheck = await db.execute<{ cnt: string }>(
      sql`SELECT COUNT(*)::text AS cnt FROM user_identities WHERE user_id IN (${placeholders})`,
    );
    identitiesCount = Number(rowsOf(identitiesCheck as any)[0]?.cnt ?? "0");
  }
  console.log(`  user_identities for deleted users = ${identitiesCount}`);

  const sessionCheck = await db.execute<{ cnt: string }>(
    sql`SELECT COUNT(*)::text AS cnt FROM session`,
  );
  const sessionCount = Number(rowsOf(sessionCheck as any)[0]?.cnt ?? "0");
  console.log(`  session rows remaining             = ${sessionCount}`);

  console.log("\n========================================");
  if (companyCount === 0 && allUsersByEmail === 0 && identitiesCount === 0) {
    console.log("  ✓ TENANT FULLY DELETED");
    console.log("  ✓ Emails are free for fresh signup");
  } else {
    console.log("  *** VERIFICATION FAILED — REVIEW ABOVE ***");
    process.exit(1);
  }
  console.log("========================================");
  console.log(`  Tenant ID:     ${tenantId}`);
  console.log(`  Tenant Name:   ${tenantRow.name ?? "(unnamed)"}`);
  console.log(`  Users deleted: ${userEmails.length}`);
  console.log("========================================");
  console.log("Summary of deletions:");
  for (const [k, v] of Object.entries(deletedCounts)) console.log(`  ${k}: ${v}`);

  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
