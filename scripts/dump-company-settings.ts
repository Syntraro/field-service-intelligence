import { db } from "../server/db";
import { companySettings, companies } from "../shared/schema";
import { eq } from "drizzle-orm";

async function main() {
  const rows = await db.select().from(companySettings);
  console.log("company_settings:");
  console.table(rows.map((r) => ({ companyId: r.companyId, companyName: (r as any).companyName, timezone: (r as any).timezone })));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(99); });
