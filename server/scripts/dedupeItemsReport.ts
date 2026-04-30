/**
 * dedupeItemsReport.ts — one-off reporting + consolidation script.
 *
 * Used 2026-04-29 to consolidate case-insensitive duplicate item names
 * across the active catalog so the new
 * `items_company_name_lower_active_uq` unique index can apply.
 *
 * Strategy:
 *   1. Detect (company_id, lower(name)) groups with > 1 active row.
 *   2. Print every group with row IDs, types, names, created_at, and
 *      flag which row will be retained (latest created_at wins).
 *   3. Soft-archive the losers (`is_active = false, deleted_at = NOW()`).
 *   4. Re-detect to confirm zero duplicate groups remain.
 *
 * Soft-delete is reversible — operators can flip `is_active` back if
 * they need to recover. No FK cascade fires; invoice_lines etc. that
 * reference archived items continue to resolve via `productId`.
 *
 * Run: tsx server/scripts/dedupeItemsReport.ts
 */
// Note: --env-file=.env on tsx loads DATABASE_URL into process.env directly;
// no dotenv import needed.
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

interface DupRow {
  company_id: string;
  name_lower: string;
  cnt: number;
  ids: string[];
  types: string[];
  names: string[];
  created_at_list: string[];
}

async function main() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    console.log("\n══════ BEFORE — duplicate detection ══════\n");
    const before = await client.query<DupRow>(`
      SELECT company_id,
             lower(name) AS name_lower,
             count(*)::int AS cnt,
             array_agg(id ORDER BY created_at DESC, id) AS ids,
             array_agg(type ORDER BY created_at DESC, id) AS types,
             array_agg(name ORDER BY created_at DESC, id) AS names,
             array_agg(created_at::text ORDER BY created_at DESC, id) AS created_at_list
        FROM items
       WHERE deleted_at IS NULL AND is_active = true
       GROUP BY company_id, lower(name)
      HAVING count(*) > 1
       ORDER BY company_id, lower(name);
    `);

    if (before.rows.length === 0) {
      console.log("No duplicate groups. Nothing to consolidate.");
      return;
    }

    const willArchive: string[] = [];
    for (const g of before.rows) {
      console.log(`Group: company=${g.company_id} name="${g.name_lower}" rows=${g.cnt}`);
      for (let i = 0; i < g.ids.length; i++) {
        const role = i === 0 ? "RETAIN " : "ARCHIVE";
        console.log(
          `  [${role}] id=${g.ids[i]} type=${g.types[i]} name="${g.names[i]}" created_at=${g.created_at_list[i]}`,
        );
        if (i > 0) willArchive.push(g.ids[i]);
      }
    }
    console.log(`\nTotal groups: ${before.rows.length}`);
    console.log(`Total rows to archive: ${willArchive.length}`);

    console.log("\n══════ Soft-archiving losers ══════\n");
    const archived = await client.query<{ id: string; name: string; type: string }>(`
      WITH ranked AS (
        SELECT id,
               row_number() OVER (
                 PARTITION BY company_id, lower(name)
                 ORDER BY created_at DESC, id
               ) AS rank_in_group
          FROM items
         WHERE deleted_at IS NULL AND is_active = true
      ),
      losers AS (
        SELECT id FROM ranked WHERE rank_in_group > 1
      )
      UPDATE items
         SET is_active = false,
             deleted_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
       WHERE id IN (SELECT id FROM losers)
       RETURNING id, name, type;
    `);

    for (const r of archived.rows) {
      console.log(`  archived: id=${r.id} type=${r.type} name="${r.name}"`);
    }

    console.log("\n══════ AFTER — re-detection ══════\n");
    const after = await client.query<DupRow>(`
      SELECT company_id, lower(name) AS name_lower, count(*)::int AS cnt
        FROM items
       WHERE deleted_at IS NULL AND is_active = true
       GROUP BY company_id, lower(name)
      HAVING count(*) > 1;
    `);
    console.log(`Remaining duplicate groups: ${after.rows.length}`);
    if (after.rows.length === 0) {
      console.log("✓ Zero duplicate groups. Type-agnostic unique index can now apply cleanly.");
    } else {
      console.error("✗ Duplicates still present — consolidation incomplete.");
      process.exit(2);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("dedupeItemsReport failed:", err);
  process.exit(1);
});
