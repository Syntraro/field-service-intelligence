import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  const rows = await db.execute<{
    id: string;
    email: string;
    full_name: string | null;
    role: string | null;
    is_schedulable: boolean | null;
    disabled: boolean | null;
    deleted_at: string | null;
    company_id: string;
  }>(sql`
    SELECT id, email, full_name, role, is_schedulable, disabled, deleted_at, company_id
    FROM users
    ORDER BY full_name NULLS LAST, email
  `);
  const records = (rows as any).rows ?? rows;
  console.log(`USERS (${records.length} rows):`);
  for (const r of records) {
    console.log(
      `  ${(r.full_name ?? r.email).padEnd(30)} role=${String(r.role).padEnd(14)} ` +
      `schedulable=${r.is_schedulable} disabled=${r.disabled} deleted=${r.deleted_at ? "yes" : "no"}`,
    );
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
