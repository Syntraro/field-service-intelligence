#!/usr/bin/env npx tsx
/**
 * Run Legacy Invoice Audit
 *
 * Usage: npx tsx scripts/run-invoice-audit.ts
 *
 * This is a READ-ONLY audit. No data is modified.
 */

import { runLegacyInvoiceAudit } from "../server/storage/invoiceAudit";
import { closeDatabasePool } from "../server/db";

async function main() {
  try {
    const result = await runLegacyInvoiceAudit();

    // Output JSON for programmatic use
    console.log("\n========== JSON OUTPUT ==========");
    console.log(JSON.stringify(result, null, 2));
    console.log("==================================\n");

    process.exit(0);
  } catch (error) {
    console.error("Audit failed:", error);
    process.exit(1);
  } finally {
    await closeDatabasePool();
  }
}

main();
