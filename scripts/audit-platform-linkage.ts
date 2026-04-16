import { db } from "../server/db";
import { users, companies } from "../shared/schema";
import { eq, ilike, or, desc, sql } from "drizzle-orm";

async function main() {
  const existing = await db
    .select({ id: users.id, email: users.email, role: users.role, companyId: users.companyId, status: users.status })
    .from(users)
    .where(eq(users.email, "ops@syntraro.com"))
    .limit(1);

  console.log("\nops@syntraro.com exists?", existing.length > 0);
  if (existing.length) console.table(existing);

  const platformishUsers = await db
    .select({ id: users.id, email: users.email, role: users.role, companyId: users.companyId })
    .from(users)
    .where(eq(users.role, "platform_admin"));
  console.log(`\nExisting platform_admin users: ${platformishUsers.length}`);
  console.table(platformishUsers);

  const internalCompanies = await db
    .select({ id: companies.id, name: companies.name, status: companies.subscriptionStatus, createdAt: companies.createdAt })
    .from(companies)
    .where(or(
      ilike(companies.name, "%syntraro%"),
      ilike(companies.name, "%platform%"),
      ilike(companies.name, "%internal%"),
    ))
    .orderBy(desc(companies.createdAt));
  console.log(`\nCandidate internal companies:`);
  console.table(internalCompanies);

  const totalCompanies = await db.select({ n: sql<number>`count(*)::int` }).from(companies);
  console.log(`\nTotal companies in DB: ${totalCompanies[0].n}`);

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(99); });
