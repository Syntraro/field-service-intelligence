/**
 * Canonical admin password-set path.
 *
 * Writes a bcrypt hash to the REAL auth table (`user_identities`), NOT
 * the legacy `users.password` column. Ensures a `provider='email'`
 * identity row exists for the user, creating it if needed. Increments
 * `users.tokenVersion` so any existing sessions are invalidated.
 *
 * Usage:
 *   # generate a strong one-time password and print it:
 *   npx tsx --env-file=.env scripts/admin-set-password.ts <email>
 *
 *   # set a specific password:
 *   npx tsx --env-file=.env scripts/admin-set-password.ts <email> <password>
 *
 * Does NOT touch: users.companyId, users.role, users.status, any other field.
 */

import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "../server/db";
import { users, userIdentities } from "../shared/schema";
import { eq, and, sql } from "drizzle-orm";

async function main() {
  const email = (process.argv[2] || "").trim().toLowerCase();
  const providedPassword = process.argv[3];
  if (!email) {
    console.error("Usage: admin-set-password <email> [password]");
    process.exit(1);
  }

  const [user] = await db
    .select({ id: users.id, email: users.email, companyId: users.companyId, status: users.status })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!user) {
    console.error(`No user found for email: ${email}`);
    process.exit(2);
  }

  const password = providedPassword || crypto.randomBytes(18).toString("base64url");
  const passwordHash = await bcrypt.hash(password, 10);
  const now = new Date();

  const [existingIdentity] = await db
    .select({ id: userIdentities.id })
    .from(userIdentities)
    .where(and(
      eq(userIdentities.userId, user.id),
      eq(userIdentities.provider, "email"),
    ))
    .limit(1);

  if (existingIdentity) {
    await db.update(userIdentities)
      .set({ passwordHash, identifier: email, updatedAt: now, verifiedAt: now })
      .where(eq(userIdentities.id, existingIdentity.id));
    console.log(`Updated existing user_identities row for ${email}`);
  } else {
    await db.insert(userIdentities).values({
      companyId: user.companyId,
      userId: user.id,
      provider: "email",
      identifier: email,
      passwordHash,
      verifiedAt: now,
    });
    console.log(`Inserted new user_identities row for ${email}`);
  }

  await db.update(users)
    .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
    .where(eq(users.id, user.id));

  console.log("\nDone. tokenVersion incremented (any active sessions invalidated).");
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║  New password for this user (share via secure channel):     ║");
  console.log(`║  ${password.padEnd(58)} ║`);
  console.log("╚══════════════════════════════════════════════════════════════╝");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(99); });
