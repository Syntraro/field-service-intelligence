/**
 * One-off: align companies.name with user-set company_settings.companyName
 * for any tenant whose companies.name looks like a signup-time placeholder
 * (contains "'s Company" — e.g., "service's Company").
 *
 * Prints the exact rows it will touch. Safe to re-run (no-op after first).
 */

import { db } from "../server/db";
import { companies, companySettings } from "../shared/schema";
import { eq, and, ilike, isNotNull, sql } from "drizzle-orm";

async function main() {
  const candidates = await db
    .select({
      id: companies.id,
      currentName: companies.name,
      displayName: companySettings.companyName,
    })
    .from(companies)
    .leftJoin(companySettings, eq(companySettings.companyId, companies.id))
    .where(and(
      ilike(companies.name, "%'s Company"),
      isNotNull(companySettings.companyName),
    ));

  console.log("Candidates:");
  console.table(candidates);

  if (candidates.length === 0) {
    console.log("Nothing to backfill.");
    process.exit(0);
  }

  for (const c of candidates) {
    if (!c.displayName) continue;
    await db.update(companies)
      .set({ name: c.displayName })
      .where(eq(companies.id, c.id));
    console.log(`Updated ${c.id}: "${c.currentName}" → "${c.displayName}"`);
  }

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(99); });
