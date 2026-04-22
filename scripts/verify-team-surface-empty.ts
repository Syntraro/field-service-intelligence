/**
 * verify-team-surface-empty — Replays the exact backend query path used
 * by the Dashboard Team workload card (`getTeamMembers` →
 * `filterSchedulableTechnicians`) and reports the count that would
 * render. 0 = blank card.
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { teamRepository } from "../server/storage/team";
import { filterSchedulableTechnicians } from "../server/domain/scheduling";

async function main() {
  const companies = await db.execute<{ id: string; name: string }>(
    sql`SELECT id, name FROM companies LIMIT 1`,
  );
  const rec = ((companies as any).rows ?? companies)[0];
  if (!rec) {
    console.error("No companies row found.");
    process.exit(1);
  }
  console.log(`Tenant under test: "${rec.name}" (${rec.id})`);

  // Exact query powering /api/team/technicians and /api/dashboard/capacity
  const members = await teamRepository.getTeamMembers(rec.id);
  const { schedulable, excluded } = filterSchedulableTechnicians(
    members,
    "verify-team-surface-empty",
  );

  console.log(`  users total            = ${members.length}`);
  console.log(`  schedulable technicians = ${schedulable.length}  (renders on Team workload)`);
  console.log(`  excluded                = ${excluded.length}`);
  for (const { user, reason } of excluded) {
    console.log(`    - ${user.fullName ?? user.email}: ${reason}`);
  }

  if (schedulable.length === 0) {
    console.log("\n✓ Team workload will render empty.");
    process.exit(0);
  }
  console.log("\n✗ Team workload would still render cards.");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
