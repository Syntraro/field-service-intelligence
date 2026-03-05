/**
 * Live Map Sanity Check — validates prerequisites for /api/map/day.
 *
 * Run: npm run db:map-sanity
 *
 * Checks:
 *   1) Active schedulable technician count > 0
 *   2) No active visits with scheduled_date but NULL scheduled_start
 *   3) Today's visit count by scheduled_start (informational)
 *
 * Exit 0 = healthy, Exit 1 = invariant violated
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

async function main() {
  let failures = 0;

  // 1) Schedulable technicians
  const [techRow] = (
    await db.execute(sql`
      SELECT COUNT(*)::int AS "count"
      FROM users
      WHERE deleted_at IS NULL
        AND disabled = false
        AND is_schedulable = true
    `)
  ).rows as any[];
  const techCount = techRow.count;
  if (techCount === 0) {
    console.error("FAIL: 0 schedulable technicians (users.is_schedulable=true, disabled=false, deleted_at IS NULL)");
    failures++;
  } else {
    console.log(`OK: ${techCount} schedulable technician(s)`);
  }

  // 2) Visits with scheduled_date but no scheduled_start
  const [gapRow] = (
    await db.execute(sql`
      SELECT COUNT(*)::int AS "count"
      FROM job_visits
      WHERE is_active = true
        AND archived_at IS NULL
        AND scheduled_start IS NULL
        AND scheduled_date IS NOT NULL
    `)
  ).rows as any[];
  const gapCount = gapRow.count;
  if (gapCount > 0) {
    console.error(`FAIL: ${gapCount} active visit(s) have scheduled_date but NULL scheduled_start`);
    failures++;
  } else {
    console.log("OK: No visits with scheduled_date-but-no-scheduled_start gap");
  }

  // 3) Today's visits by scheduled_start (Toronto timezone)
  const [todayRow] = (
    await db.execute(sql`
      SELECT COUNT(*)::int AS "count"
      FROM job_visits
      WHERE is_active = true
        AND archived_at IS NULL
        AND scheduled_start >= (NOW() AT TIME ZONE 'America/Toronto')::date
        AND scheduled_start < ((NOW() AT TIME ZONE 'America/Toronto')::date + INTERVAL '1 day')
    `)
  ).rows as any[];
  console.log(`INFO: ${todayRow.count} visit(s) scheduled today by scheduled_start (Toronto)`);

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exit(1);
  } else {
    console.log("\nAll checks passed.");
    process.exit(0);
  }
}

main().catch((e) => {
  console.error("Sanity check error:", e);
  process.exit(1);
});
