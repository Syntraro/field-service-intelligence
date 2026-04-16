import { db } from "../server/db";
import { companies, users } from "../shared/schema";
import { eq } from "drizzle-orm";
async function main() {
  const all = await db.select({
    id: companies.id, name: companies.name,
    status: companies.subscriptionStatus, createdAt: companies.createdAt,
  }).from(companies);
  console.log("companies:");
  console.table(all);
  const allUsers = await db.select({
    id: users.id, email: users.email, companyId: users.companyId,
    role: users.role, fullName: users.fullName, firstName: users.firstName, lastName: users.lastName,
  }).from(users);
  console.log("users:");
  console.table(allUsers);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(99); });
// also check company_settings
import { companySettings } from "../shared/schema";
db.select().from(companySettings).then((r) => { console.log("company_settings:"); console.table(r); process.exit(0); });
