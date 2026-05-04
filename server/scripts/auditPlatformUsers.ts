/**
 * Audit-only: list every platform identity in the database.
 *
 * Read-only. Does not mutate or expose passwords. Run with:
 *   npx tsx server/scripts/auditPlatformUsers.ts
 *
 * Phase 2-A (2026-05-04): primary source is `platform_users`. The
 * legacy `users WHERE role IN PLATFORM_ROLES` listing is also emitted
 * in a second section so operators can verify that the backfill
 * migration covered every legacy row before the destructive cleanup
 * runs (Phase 5). After cleanup, the legacy section will report 0 rows.
 */

// Load .env BEFORE the db module so DATABASE_URL is set when it imports.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, "../../.env");
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim();
    }
  }
}

const PLATFORM_ROLES = [
  "platform_admin",
  "platform_support",
  "platform_billing",
  "platform_readonly_audit",
];

async function main() {
  const { platformIdentityRepository } = await import("../storage/platformIdentity");
  const { db } = await import("../db");
  const { users, userIdentities } = await import("@shared/schema");
  const { eq, inArray, and, isNotNull } = await import("drizzle-orm");

  // ── 1) Canonical: platform_users ─────────────────────────────────
  const platformRows = await platformIdentityRepository.listPlatformUsers();
  console.log(
    `[platform_users] Found ${platformRows.length} platform identity row(s):`,
  );
  for (const r of platformRows) {
    console.log(
      JSON.stringify({
        source: "platform_users",
        email: r.email,
        roles: r.roles,
        status: r.status,
        disabled: r.disabled,
        tokenVersion: r.tokenVersion,
        lastLoginAt: r.lastLoginAt,
        hasIdentityWithPassword: r.hasPasswordIdentity,
      }),
    );
  }

  // ── 2) Legacy: users WHERE role IN PLATFORM_ROLES ────────────────
  // After Phase 5 cleanup this returns 0 — kept until then so operators
  // can confirm backfill parity. Distinct `source` field on output so
  // logs make the table-of-origin obvious.
  const legacyRows = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      status: users.status,
      companyId: users.companyId,
      tokenVersion: users.tokenVersion,
    })
    .from(users)
    .where(inArray(users.role, PLATFORM_ROLES));

  console.log(
    `[users (legacy)] Found ${legacyRows.length} platform-role row(s) still in tenant table:`,
  );
  for (const r of legacyRows) {
    const ids = await db
      .select({ provider: userIdentities.provider })
      .from(userIdentities)
      .where(
        and(
          eq(userIdentities.userId, r.id),
          isNotNull(userIdentities.passwordHash),
        ),
      );
    console.log(
      JSON.stringify({
        source: "users (legacy)",
        email: r.email,
        role: r.role,
        status: r.status,
        companyId: r.companyId,
        tokenVersion: r.tokenVersion,
        hasIdentityWithPassword: ids.length > 0,
      }),
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
