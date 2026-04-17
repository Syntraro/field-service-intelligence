import { db } from "../server/db";
import { users } from "../shared/schema";
async function main() {
  const rs = await db.select({ email: users.email, lastLoginAt: users.lastLoginAt }).from(users);
  console.table(rs);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(99); });
