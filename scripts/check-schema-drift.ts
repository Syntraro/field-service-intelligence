/**
 * Schema Drift Detection Script
 *
 * Compares the live PostgreSQL database schema against expected Drizzle schema definitions.
 * Detects missing columns and nullability mismatches to prevent runtime 500 errors.
 *
 * Usage: npm run db:check
 *
 * Exit codes:
 *   0 - Schema aligned (or DATABASE_URL not set in development)
 *   1 - Schema drift detected
 */

import { Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { neonConfig } from '@neondatabase/serverless';

neonConfig.webSocketConstructor = ws;

// ============================================================================
// EXPECTED SCHEMA DEFINITIONS
// ============================================================================
// Define critical columns for each table. Focus on columns that would cause
// runtime errors if missing. Format: { column_name: { nullable: boolean } }

interface ColumnSpec {
  nullable: boolean;
}

interface TableSchema {
  [columnName: string]: ColumnSpec;
}

interface ExpectedSchemas {
  [tableName: string]: TableSchema;
}

const expectedSchemas: ExpectedSchemas = {
  // client_locations (aliased as "clients" in code)
  client_locations: {
    id: { nullable: false },
    company_id: { nullable: false },
    company_name: { nullable: false },
    location: { nullable: true },
    address: { nullable: true },
    city: { nullable: true },
    province: { nullable: true },
    postal_code: { nullable: true },
    contact_name: { nullable: true },
    email: { nullable: true },
    phone: { nullable: true },
    selected_months: { nullable: false },
    inactive: { nullable: false },
    is_primary: { nullable: false },
    needs_details: { nullable: false },
    bill_with_parent: { nullable: false },
    version: { nullable: false },
    created_at: { nullable: false },
    updated_at: { nullable: false },
    deleted_at: { nullable: true },
  },

  // jobs table
  jobs: {
    id: { nullable: false },
    company_id: { nullable: false },
    location_id: { nullable: false },
    job_number: { nullable: false },
    status: { nullable: false },
    priority: { nullable: false },
    job_type: { nullable: false },
    summary: { nullable: false },
    description: { nullable: true },
    scheduled_start: { nullable: true },
    scheduled_end: { nullable: true },
    actual_start: { nullable: true },
    actual_end: { nullable: true },
    invoice_id: { nullable: true },
    action_required_reason: { nullable: true },
    action_required_notes: { nullable: true },
    next_action_date: { nullable: true },
    action_required_at: { nullable: true },
    action_required_escalated_at: { nullable: true },
    previous_status: { nullable: true },
    closed_at: { nullable: true },
    closed_by: { nullable: true },
    is_active: { nullable: false },
    version: { nullable: false },
    created_at: { nullable: false },
    updated_at: { nullable: true },
    deleted_at: { nullable: true },
  },

  // job_status_events table (audit trail)
  job_status_events: {
    id: { nullable: false },
    company_id: { nullable: false },
    job_id: { nullable: false },
    changed_at: { nullable: false },
    changed_by: { nullable: true },
    from_status: { nullable: false },
    to_status: { nullable: false },
    note: { nullable: true },
    meta: { nullable: true },
  },

  // job_parts table
  job_parts: {
    id: { nullable: false },
    company_id: { nullable: false },
    job_id: { nullable: false },
    product_id: { nullable: true },
    equipment_id: { nullable: true },
    description: { nullable: false },
    quantity: { nullable: false },
    unit_cost: { nullable: true },
    unit_price: { nullable: true },
    equipment_label: { nullable: true },
    sort_order: { nullable: false },
    is_active: { nullable: false },
    created_at: { nullable: false },
    updated_at: { nullable: true },
    deleted_at: { nullable: true },
  },
};

// ============================================================================
// DATABASE SCHEMA FETCHING
// ============================================================================

interface DBColumn {
  table_name: string;
  column_name: string;
  is_nullable: 'YES' | 'NO';
}

async function fetchDatabaseSchema(pool: Pool, tables: string[]): Promise<Map<string, Map<string, DBColumn>>> {
  const tableList = tables.map(t => `'${t}'`).join(', ');

  const result = await pool.query(`
    SELECT
      table_name,
      column_name,
      is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN (${tableList})
    ORDER BY table_name, ordinal_position
  `);

  const schemaMap = new Map<string, Map<string, DBColumn>>();

  for (const row of result.rows as DBColumn[]) {
    if (!schemaMap.has(row.table_name)) {
      schemaMap.set(row.table_name, new Map());
    }
    schemaMap.get(row.table_name)!.set(row.column_name, row);
  }

  return schemaMap;
}

// ============================================================================
// DRIFT DETECTION
// ============================================================================

interface DriftIssue {
  table: string;
  column: string;
  issue: 'missing' | 'nullability_mismatch';
  expected?: string;
  actual?: string;
}

function detectDrift(
  expected: ExpectedSchemas,
  actual: Map<string, Map<string, DBColumn>>
): DriftIssue[] {
  const issues: DriftIssue[] = [];

  for (const [tableName, columns] of Object.entries(expected)) {
    const dbTable = actual.get(tableName);

    if (!dbTable) {
      // Entire table missing - add all columns as missing
      for (const columnName of Object.keys(columns)) {
        issues.push({
          table: tableName,
          column: columnName,
          issue: 'missing',
        });
      }
      continue;
    }

    for (const [columnName, spec] of Object.entries(columns)) {
      const dbColumn = dbTable.get(columnName);

      if (!dbColumn) {
        issues.push({
          table: tableName,
          column: columnName,
          issue: 'missing',
        });
        continue;
      }

      // Check nullability
      const dbNullable = dbColumn.is_nullable === 'YES';
      if (dbNullable !== spec.nullable) {
        issues.push({
          table: tableName,
          column: columnName,
          issue: 'nullability_mismatch',
          expected: spec.nullable ? 'nullable' : 'NOT NULL',
          actual: dbNullable ? 'nullable' : 'NOT NULL',
        });
      }
    }
  }

  return issues;
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;

  // Handle missing DATABASE_URL gracefully
  if (!databaseUrl) {
    console.log('⚠️  DATABASE_URL not set - skipping schema drift check');
    console.log('   Set DATABASE_URL to enable schema validation');
    process.exit(0);
  }

  console.log('🔍 Checking for schema drift...\n');

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    const tables = Object.keys(expectedSchemas);
    console.log(`   Validating ${tables.length} tables: ${tables.join(', ')}\n`);

    const dbSchema = await fetchDatabaseSchema(pool, tables);
    const issues = detectDrift(expectedSchemas, dbSchema);

    if (issues.length === 0) {
      console.log('✓ Schema drift check passed — database is aligned with Drizzle schema\n');
      process.exit(0);
    }

    // Group issues by table for cleaner output
    const issuesByTable = new Map<string, DriftIssue[]>();
    for (const issue of issues) {
      if (!issuesByTable.has(issue.table)) {
        issuesByTable.set(issue.table, []);
      }
      issuesByTable.get(issue.table)!.push(issue);
    }

    console.log('✗ Schema drift detected!\n');

    for (const [table, tableIssues] of issuesByTable) {
      console.log(`  Table: "${table}"`);
      for (const issue of tableIssues) {
        if (issue.issue === 'missing') {
          console.log(`    - Missing column in DB: ${issue.column}`);
        } else if (issue.issue === 'nullability_mismatch') {
          console.log(`    - Nullability mismatch: ${issue.column} (expected: ${issue.expected}, actual: ${issue.actual})`);
        }
      }
      console.log('');
    }

    console.log('💡 To fix:');
    console.log('   1. Create a migration to add missing columns');
    console.log('   2. Run: psql $DATABASE_URL -f migrations/<your_migration>.sql');
    console.log('   3. Run: npm run db:push\n');

    process.exit(1);
  } catch (error) {
    console.error('❌ Error checking schema:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
