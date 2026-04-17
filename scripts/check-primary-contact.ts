import { platformTenantsService } from "../server/services/platformTenantsService";
import { db } from "../server/db";
import { companies } from "../shared/schema";
import { sql } from "drizzle-orm";

async function main() {
  const rows = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(sql`${companies.subscriptionStatus} != 'internal'`);

  for (const c of rows) {
    const d = await platformTenantsService.getTenantDetail(c.id);
    const o = d?.tenant.owner;
    const contactName =
      o?.fullName?.trim()
      || [o?.firstName, o?.lastName].filter(Boolean).join(" ").trim()
      || o?.email
      || "—";
    console.log(`${c.name}:`);
    console.log(`  primary contact → ${contactName} (${o?.email ?? "—"}) id=${o?.id ?? "—"}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(99); });
