import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function verifyIndexes() {
  console.log('Verifying database indexes...\n');

  const result = await db.execute(sql`
    SELECT
      schemaname,
      tablename,
      indexname,
      indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname LIKE 'idx_%'
    ORDER BY tablename, indexname
  `);

  console.log(`✅ Found ${result.rows.length} custom indexes\n`);

  // Group by table
  const byTable: Record<string, number> = {};
  for (const row of result.rows) {
    const table = row.tablename as string;
    byTable[table] = (byTable[table] || 0) + 1;
  }

  console.log('Indexes by table:');
  for (const [table, count] of Object.entries(byTable).sort()) {
    console.log(`  ${table}: ${count} indexes`);
  }

  console.log('\nExpected critical indexes:');
  const critical = [
    'idx_jobs_company_status',
    'idx_jobs_company_scheduled',
    'idx_invoices_company_status',
    'idx_users_company_id',
    'idx_parts_company_active',
    'idx_labor_entries_job_id',
    'idx_job_parts_job_id',
    'idx_invoice_lines_invoice_id',
    'idx_jobs_search',
    'idx_parts_search',
    'idx_clients_search',
    'idx_jobs_active',
    'idx_invoices_pending',
    'idx_jobs_list_covering',
    'idx_invoices_list_covering',
  ];

  let missingCount = 0;
  for (const indexName of critical) {
    const exists = result.rows.some((r) => r.indexname === indexName);
    if (exists) {
      console.log(`  ✅ ${indexName}`);
    } else {
      console.log(`  ❌ ${indexName} (MISSING)`);
      missingCount++;
    }
  }

  if (missingCount > 0) {
    console.log(`\n⚠️  WARNING: ${missingCount} critical indexes are missing!`);
    console.log('Run: psql $DATABASE_URL -f migrations/0001_critical_indexes.sql');
    process.exit(1);
  } else {
    console.log(`\n✅ All ${critical.length} critical indexes are present!`);
    process.exit(0);
  }
}

verifyIndexes().catch((err) => {
  console.error('Error verifying indexes:', err);
  process.exit(1);
});
