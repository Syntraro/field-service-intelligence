/**
 * Schema Guard - Startup validation to prevent schema mismatches
 *
 * This module verifies that critical database columns exist BEFORE the server
 * starts accepting requests. If any required columns are missing, the server
 * will refuse to start with a clear error message.
 *
 * WHY THIS EXISTS:
 * - Prevents silent 500 errors when queries reference missing columns
 * - Catches unrun migrations before they cause production incidents
 * - Provides clear instructions for how to fix the issue
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Required columns by table.
 * Add entries here when new columns are added to the schema.
 * Format: { tableName: [columnName, ...] }
 */
const REQUIRED_COLUMNS: Record<string, string[]> = {
  invoices: [
    // Core fields
    "id",
    "company_id",
    "location_id",
    "invoice_number",
    "status",
    // QBO Lock fields (Phase 10A)
    "billing_locked_at",
    "billing_lock_reason",
    "qbo_out_of_sync",
    "qbo_out_of_sync_at",
    "qbo_out_of_sync_reason",
    "last_billing_edit_at",
    "last_billing_edit_by",
    // Discount fields (Phase 11)
    "discount_type",
    "discount_percent",
    "discount_amount",
    "discount_notes",
    // Payment terms fields
    "payment_terms_days",
    "issued_at",
    "sent_by_user_id",
  ],
  company_settings: [
    "id",
    "company_id",
    "default_payment_terms_days",
  ],
};

export interface SchemaValidationResult {
  valid: boolean;
  missingColumns: Array<{ table: string; column: string }>;
}

/**
 * Validate that all required columns exist in the database.
 * Returns validation result with list of missing columns.
 */
export async function validateSchema(): Promise<SchemaValidationResult> {
  const missingColumns: Array<{ table: string; column: string }> = [];

  for (const [tableName, columns] of Object.entries(REQUIRED_COLUMNS)) {
    // Query existing columns for this table
    const result = await db.execute(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = ${tableName}
    `);

    const existingColumns = new Set(
      result.rows.map((row: any) => row.column_name)
    );

    // Check each required column
    for (const column of columns) {
      if (!existingColumns.has(column)) {
        missingColumns.push({ table: tableName, column });
      }
    }
  }

  return {
    valid: missingColumns.length === 0,
    missingColumns,
  };
}

/**
 * Run schema validation and exit if critical columns are missing.
 * Call this at server startup BEFORE accepting requests.
 */
export async function enforceSchemaOrExit(): Promise<void> {
  try {
    const result = await validateSchema();

    if (!result.valid) {
      console.error("\n" + "=".repeat(70));
      console.error("FATAL: Database schema mismatch detected");
      console.error("=".repeat(70));
      console.error("\nThe following required columns are missing:\n");

      for (const { table, column } of result.missingColumns) {
        console.error(`  - ${table}.${column}`);
      }

      console.error("\n" + "-".repeat(70));
      console.error("HOW TO FIX:");
      console.error("-".repeat(70));
      console.error("1. Check the migrations/ folder for pending migrations");
      console.error("2. Run migrations against the database:");
      console.error("   psql $DATABASE_URL -f migrations/<migration_file>.sql");
      console.error("3. Restart the server");
      console.error("\nThe server will NOT start until this is resolved.");
      console.error("=".repeat(70) + "\n");

      process.exit(1);
    }

    console.log("[Schema Guard] All required columns verified ✓");
  } catch (error: any) {
    console.error("[Schema Guard] Failed to validate schema:", error.message);
    // Don't exit on connection errors during startup - let the main app handle it
    throw error;
  }
}
