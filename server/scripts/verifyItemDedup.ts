// One-off verification 2026-04-29 — confirm:
//   • items_company_name_lower_active_uq exists (type-agnostic)
//   • items_company_type_name_lower_active_uq is gone (type-scoped, replaced)
//   • zero active duplicate (company_id, lower(name)) groups
//   • the row archived during consolidation is still referenced by any
//     existing invoice_lines via productId (no orphans, no broken FKs)
//   • a type-agnostic POST attempt would now collide (simulated via
//     direct INSERT) — kept commented unless you want to actually try.
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

async function main() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    console.log("\n══════ Index inventory ══════\n");
    const idx = await client.query<{ indexname: string; indexdef: string }>(`
      SELECT indexname, indexdef
        FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename = 'items'
         AND indexname IN (
           'items_company_name_lower_active_uq',
           'items_company_type_name_lower_active_uq'
         )
       ORDER BY indexname;
    `);
    for (const r of idx.rows) {
      console.log(`  ${r.indexname}`);
      console.log(`    ${r.indexdef}`);
    }
    const newPresent = idx.rows.find(r => r.indexname === "items_company_name_lower_active_uq");
    const oldPresent = idx.rows.find(r => r.indexname === "items_company_type_name_lower_active_uq");
    console.log(`\n  type-agnostic index present:  ${newPresent ? "YES ✓" : "NO ✗"}`);
    console.log(`  type-scoped index present:    ${oldPresent ? "YES (drop failed)" : "NO ✓"}`);

    console.log("\n══════ Active duplicate scan ══════\n");
    const dups = await client.query<{ cnt: number }>(`
      SELECT count(*)::int AS cnt
        FROM (
          SELECT 1
            FROM items
           WHERE deleted_at IS NULL AND is_active = true
           GROUP BY company_id, lower(name)
          HAVING count(*) > 1
        ) sub;
    `);
    console.log(`  Active duplicate groups: ${dups.rows[0].cnt} (expected 0)`);

    console.log("\n══════ Archived row reference check ══════\n");
    // The archived "service Thermostat" row id from consolidation:
    const archivedId = "a399617e-8b51-4b47-9204-a9d70875a139";
    const refs = await client.query<{ cnt: number }>(`
      SELECT count(*)::int AS cnt FROM invoice_lines WHERE product_id = $1;
    `, [archivedId]);
    console.log(`  invoice_lines referencing archived id ${archivedId}: ${refs.rows[0].cnt}`);
    if (refs.rows[0].cnt > 0) {
      const sample = await client.query<{
        id: string; invoice_id: string; description: string; line_number: number;
      }>(`
        SELECT id, invoice_id, description, line_number
          FROM invoice_lines
         WHERE product_id = $1
         LIMIT 5;
      `, [archivedId]);
      console.log(`  sample referencing rows (still resolvable — soft-delete only):`);
      for (const r of sample.rows) {
        console.log(`    line ${r.line_number} on invoice ${r.invoice_id}: "${r.description}"`);
      }
    } else {
      console.log(`  No invoice_lines reference the archived row — clean archive.`);
    }

    console.log("\n══════ Archived row state ══════\n");
    const archivedRow = await client.query<{
      id: string; name: string; type: string; is_active: boolean; deleted_at: string;
    }>(`
      SELECT id, name, type, is_active, deleted_at::text
        FROM items
       WHERE id = $1;
    `, [archivedId]);
    if (archivedRow.rows[0]) {
      const r = archivedRow.rows[0];
      console.log(`  id=${r.id} name="${r.name}" type=${r.type} is_active=${r.is_active} deleted_at=${r.deleted_at}`);
      console.log(`  Reversible: UPDATE items SET is_active=true, deleted_at=NULL WHERE id='${r.id}';`);
    }

    console.log("\n══════ Schema migration tracking ══════\n");
    const sm = await client.query<{ filename: string; applied_at: string }>(`
      SELECT filename, applied_at::text
        FROM schema_migrations
       WHERE filename LIKE '2026_04_29%'
       ORDER BY filename;
    `);
    for (const r of sm.rows) {
      console.log(`  ${r.applied_at}  ${r.filename}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("verifyItemDedup failed:", err);
  process.exit(1);
});
