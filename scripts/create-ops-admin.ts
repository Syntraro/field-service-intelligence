/**
 * Create the dedicated internal ops account: ops@syntraro.com
 *
 * Safe-by-design:
 *  - Creates (or reuses) a dedicated "Syntraro Platform (Internal)" company
 *    row so the ops user is NOT linked to any real tenant.
 *  - Idempotent: re-running updates the existing ops user in place.
 *  - Prints a freshly generated one-time password to stdout. Intended
 *    workflow: operator uses /request-reset to set their own.
 */

import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "../server/db";
import { users, companies } from "../shared/schema";
import { eq, sql } from "drizzle-orm";

const OPS_EMAIL = "ops@syntraro.com";
const OPS_COMPANY_NAME = "Syntraro Platform (Internal)";

async function ensureInternalCompany(): Promise<{ id: string; name: string; created: boolean }> {
  const [existing] = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(eq(companies.name, OPS_COMPANY_NAME))
    .limit(1);

  if (existing) return { ...existing, created: false };

  const [created] = await db
    .insert(companies)
    .values({
      name: OPS_COMPANY_NAME,
      subscriptionStatus: "internal",
      subscriptionPlan: null,
    })
    .returning({ id: companies.id, name: companies.name });

  return { ...created, created: true };
}

async function main() {
  const company = await ensureInternalCompany();
  console.log(`\nInternal company (${company.created ? "CREATED" : "REUSED"}):`);
  console.table([company]);

  // Strong one-time password. Will be rotated via reset flow.
  const tempPassword = crypto.randomBytes(18).toString("base64url");
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  const [existingUser] = await db
    .select({ id: users.id, email: users.email, role: users.role, status: users.status, companyId: users.companyId })
    .from(users)
    .where(eq(users.email, OPS_EMAIL))
    .limit(1);

  let row;
  if (existingUser) {
    [row] = await db
      .update(users)
      .set({
        role: "platform_admin",
        status: "active",
        password: passwordHash,
        companyId: company.id,
        tokenVersion: sql`${users.tokenVersion} + 1`,
      })
      .where(eq(users.id, existingUser.id))
      .returning({
        id: users.id, email: users.email, role: users.role,
        status: users.status, companyId: users.companyId, tokenVersion: users.tokenVersion,
      });
    console.log("\nOps user (UPDATED):");
  } else {
    [row] = await db
      .insert(users)
      .values({
        email: OPS_EMAIL,
        password: passwordHash,
        role: "platform_admin",
        status: "active",
        companyId: company.id,
        fullName: "Syntraro Ops",
        isSchedulable: false,
      })
      .returning({
        id: users.id, email: users.email, role: users.role,
        status: users.status, companyId: users.companyId, tokenVersion: users.tokenVersion,
      });
    console.log("\nOps user (CREATED):");
  }
  console.table([row]);

  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║  One-time password (rotate immediately via /request-reset):   ║");
  console.log(`║  ${tempPassword.padEnd(60)} ║`);
  console.log("╚════════════════════════════════════════════════════════════════╝");

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(99); });
