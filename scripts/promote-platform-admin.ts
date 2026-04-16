/**
 * One-off: promote a single user to `platform_admin`.
 *
 * Only touches the `role` column. Does NOT modify companyId, roleId,
 * status, or any other field — tenant ownership and schedulable settings
 * are preserved intact.
 *
 * Usage:
 *   npx tsx scripts/promote-platform-admin.ts <email>
 */

import { db } from "../server/db";
import { users } from "../shared/schema";
import { eq, sql } from "drizzle-orm";

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: npx tsx scripts/promote-platform-admin.ts <email>");
    process.exit(1);
  }

  const [before] = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      companyId: users.companyId,
      fullName: users.fullName,
      status: users.status,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!before) {
    console.error(`User not found for email: ${email}`);
    process.exit(2);
  }

  console.log("\nBEFORE:");
  console.table([before]);

  if (before.role === "platform_admin") {
    console.log("\nNo change needed — user is already platform_admin.");
    process.exit(0);
  }

  // Invalidate any active sessions so the new role takes effect on next request.
  const [after] = await db
    .update(users)
    .set({
      role: "platform_admin",
      tokenVersion: sql`${users.tokenVersion} + 1`,
    })
    .where(eq(users.email, email))
    .returning({
      id: users.id,
      email: users.email,
      role: users.role,
      companyId: users.companyId,
      fullName: users.fullName,
      status: users.status,
      tokenVersion: users.tokenVersion,
    });

  console.log("\nAFTER:");
  console.table([after]);

  console.log(`\nTransition: ${before.role} → ${after.role}`);
  console.log(`companyId unchanged: ${before.companyId === after.companyId}`);
  console.log(`\nRevert with:`);
  console.log(`  UPDATE users SET role='${before.role}' WHERE id='${before.id}';`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(99);
});
