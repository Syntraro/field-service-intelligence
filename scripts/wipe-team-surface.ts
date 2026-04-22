/**
 * wipe-team-surface — Clear the technician/team surface for a fresh tenant.
 *
 * Context: `resetBusinessData` preserves `users` so you can still log in.
 * The Dashboard Team workload card + `/api/team/technicians` dropdown
 * derive from `users WHERE is_schedulable = true` (see
 * `server/domain/scheduling.ts::isTechnicianSchedulable`). For a
 * brand-new-tenant feel we flip every preserved user to `is_schedulable =
 * false`. They keep their login; they just no longer render as techs
 * until someone turns the flag back on in Settings → Team.
 *
 * Also clears calendar-color + labour-rate overrides on technicianProfiles
 * rows — but that table is already wiped by resetBusinessData, so this is
 * a no-op in normal use and defensive only.
 *
 * Safety: same guard as resetBusinessData — NODE_ENV must not be
 * "production" and RESET_TENANT_DATA=true must be set.
 */

import { sql } from "drizzle-orm";
import { db } from "../server/db";

if (process.env.NODE_ENV === "production") {
  console.error("FATAL: wipe-team-surface cannot run in production.");
  process.exit(1);
}
if (process.env.RESET_TENANT_DATA !== "true") {
  console.error(
    "FATAL: Set RESET_TENANT_DATA=true to confirm the team-surface wipe.\n" +
    "Usage: RESET_TENANT_DATA=true npx tsx --env-file=.env scripts/wipe-team-surface.ts",
  );
  process.exit(1);
}

async function main() {
  const pre = await db.execute<{ cnt: string }>(
    sql`SELECT COUNT(*)::text AS cnt FROM users WHERE is_schedulable = true`,
  );
  const preCount = Number(((pre as any).rows ?? pre)[0]?.cnt ?? "0");

  if (preCount === 0) {
    console.log("Team surface already wiped — no users have is_schedulable = true.");
    process.exit(0);
  }

  console.log(`Flipping ${preCount} user row(s) to is_schedulable = false…`);
  await db.execute(sql`UPDATE users SET is_schedulable = false`);

  const post = await db.execute<{ cnt: string }>(
    sql`SELECT COUNT(*)::text AS cnt FROM users WHERE is_schedulable = true`,
  );
  const postCount = Number(((post as any).rows ?? post)[0]?.cnt ?? "0");
  console.log(`Remaining users with is_schedulable = true: ${postCount}`);
  if (postCount !== 0) {
    console.error("ERROR: some users still flagged schedulable.");
    process.exit(1);
  }

  console.log("Done. Dashboard Team workload will render empty.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
