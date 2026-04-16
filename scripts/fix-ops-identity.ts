/**
 * Diagnose + fix login for ops@syntraro.com.
 *
 * Auth flow uses `user_identities.passwordHash` — NOT `users.password`.
 * The create-ops-admin script only wrote `users.password`, leaving
 * `user_identities` with no row for this user. That's why login fails
 * with "Invalid email or password" (findUserByEmailGlobal returns null).
 *
 * This script:
 *   1. Prints the diagnostic state for every gate the LocalStrategy checks.
 *   2. Creates the missing user_identities row with a fresh bcrypt hash.
 *   3. Re-runs the diagnostic to prove login will succeed.
 */

import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "../server/db";
import { users, userIdentities, companies } from "../shared/schema";
import { eq, and, sql } from "drizzle-orm";

const EMAIL = "ops@syntraro.com";

async function diagnose(label: string) {
  console.log(`\n=== ${label} ===`);

  const [user] = await db.select({
    id: users.id, email: users.email, role: users.role,
    status: users.status, disabled: users.disabled, companyId: users.companyId,
  }).from(users).where(eq(users.email, EMAIL)).limit(1);

  console.log("user row:");
  console.table(user ? [user] : []);

  if (!user) return null;

  const [company] = await db.select({
    id: companies.id, name: companies.name, subscriptionStatus: companies.subscriptionStatus,
  }).from(companies).where(eq(companies.id, user.companyId)).limit(1);
  console.log("company row:");
  console.table(company ? [company] : []);

  const identities = await db.select({
    id: userIdentities.id, provider: userIdentities.provider, identifier: userIdentities.identifier,
    hasPasswordHash: sql<boolean>`(${userIdentities.passwordHash} IS NOT NULL)`,
    companyId: userIdentities.companyId, userId: userIdentities.userId,
  }).from(userIdentities).where(eq(userIdentities.userId, user.id));
  console.log(`user_identities rows for user.id=${user.id}:`);
  console.table(identities);

  // Gate-by-gate (mirrors server/auth.ts LocalStrategy):
  const ident = identities.find((i) => i.provider === "email");
  console.log("Gate analysis:");
  console.log(`  findUserByEmailGlobal would return: ${ident ? "MATCH" : "NULL → 'Invalid email or password'"}`);
  console.log(`  identity.passwordHash present:      ${ident?.hasPasswordHash ?? "n/a"}`);
  console.log(`  user.disabled:                      ${user.disabled}`);
  console.log(`  user.status === 'deactivated':      ${user.status === "deactivated"}`);
  console.log(`  platform_admin blocked by auth?:    NO (no role check in LocalStrategy)`);

  return { user, company, identities, emailIdentity: ident };
}

async function main() {
  const before = await diagnose("BEFORE");
  if (!before?.user) { console.error("ops user does not exist."); process.exit(2); }

  if (before.emailIdentity) {
    console.log("\nIdentity already exists. Rotating its password hash to a fresh one-time value.");
  } else {
    console.log("\nROOT CAUSE CONFIRMED: no user_identities row exists for ops@syntraro.com.");
  }

  const tempPassword = crypto.randomBytes(18).toString("base64url");
  const passwordHash = await bcrypt.hash(tempPassword, 10);
  const now = new Date();

  if (before.emailIdentity) {
    await db.update(userIdentities)
      .set({ passwordHash, updatedAt: now, verifiedAt: now })
      .where(eq(userIdentities.id, before.emailIdentity.id));
  } else {
    await db.insert(userIdentities).values({
      companyId: before.user.companyId,
      userId: before.user.id,
      provider: "email",
      identifier: EMAIL.toLowerCase(),
      passwordHash,
      verifiedAt: now,
    });
  }

  // Invalidate any stale sessions.
  await db.update(users)
    .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
    .where(eq(users.id, before.user.id));

  await diagnose("AFTER");

  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║  One-time password for ops@syntraro.com:                      ║");
  console.log(`║  ${tempPassword.padEnd(60)} ║`);
  console.log("╚════════════════════════════════════════════════════════════════╝");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(99); });
