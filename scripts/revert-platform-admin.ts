import { db } from "../server/db";
import { users } from "../shared/schema";
import { eq, sql } from "drizzle-orm";

async function main() {
  const email = process.argv[2];
  const targetRole = process.argv[3] || "technician";
  if (!email) { console.error("Usage: revert <email> [role]"); process.exit(1); }

  const [before] = await db.select({
    id: users.id, email: users.email, role: users.role, companyId: users.companyId, status: users.status,
  }).from(users).where(eq(users.email, email)).limit(1);

  if (!before) { console.error("Not found:", email); process.exit(2); }

  console.log("\nBEFORE:");
  console.table([before]);

  const [after] = await db.update(users).set({
    role: targetRole,
    tokenVersion: sql`${users.tokenVersion} + 1`,
  }).where(eq(users.email, email)).returning({
    id: users.id, email: users.email, role: users.role, companyId: users.companyId, status: users.status, tokenVersion: users.tokenVersion,
  });

  console.log("\nAFTER:");
  console.table([after]);
  console.log(`\nTransition: ${before.role} → ${after.role}`);
  console.log(`companyId unchanged: ${before.companyId === after.companyId}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(99); });
