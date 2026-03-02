#!/usr/bin/env npx tsx
/**
 * Backfill quotes.customerCompanyId
 *
 * Fixes quotes where customerCompanyId is NULL or mismatched with their
 * location's parentCompanyId. For locations without a parentCompanyId,
 * the script resolves one via find-or-create (same logic as quote creation).
 *
 * Usage:
 *   npx tsx server/scripts/backfillQuoteCustomerCompanyId.ts           # Dry run
 *   npx tsx server/scripts/backfillQuoteCustomerCompanyId.ts --fix     # Apply changes
 *   npx tsx server/scripts/backfillQuoteCustomerCompanyId.ts --fix --company <id>  # Single tenant
 *
 * Safe to run multiple times (idempotent).
 */

import { db } from "../db";
import { quotes, clientLocations, companies } from "@shared/schema";
import { eq, and, isNull, isNotNull, sql, ne } from "drizzle-orm";
import { resolveCustomerCompanyForLocation } from "../services/customerCompanyResolver";

const args = process.argv.slice(2);
const dryRun = !args.includes("--fix");
const companyFlag = args.indexOf("--company");
const singleCompanyId = companyFlag >= 0 ? args[companyFlag + 1] : null;

interface Summary {
  totalScanned: number;
  updatedNulls: number;
  updatedMismatches: number;
  skipped: number;
  errors: string[];
}

async function main() {
  console.log("=== Backfill quotes.customerCompanyId ===");
  console.log(`Mode: ${dryRun ? "DRY RUN (no changes)" : "LIVE — will update rows"}`);
  if (singleCompanyId) console.log(`Scope: company ${singleCompanyId}`);
  console.log("");

  // Get all tenant companies (or the single one)
  const tenants = singleCompanyId
    ? [{ id: singleCompanyId }]
    : await db.select({ id: companies.id }).from(companies);

  const totals: Summary = { totalScanned: 0, updatedNulls: 0, updatedMismatches: 0, skipped: 0, errors: [] };

  for (const tenant of tenants) {
    const summary = await backfillForTenant(tenant.id, dryRun);
    totals.totalScanned += summary.totalScanned;
    totals.updatedNulls += summary.updatedNulls;
    totals.updatedMismatches += summary.updatedMismatches;
    totals.skipped += summary.skipped;
    totals.errors.push(...summary.errors);
  }

  console.log("\n=== SUMMARY ===");
  console.log(`Total quotes scanned: ${totals.totalScanned}`);
  console.log(`Updated (was NULL):   ${totals.updatedNulls}`);
  console.log(`Updated (mismatch):   ${totals.updatedMismatches}`);
  console.log(`Skipped:              ${totals.skipped}`);
  if (totals.errors.length > 0) {
    console.log(`Errors:               ${totals.errors.length}`);
    totals.errors.forEach((e) => console.log(`  - ${e}`));
  }
  if (dryRun) {
    console.log("\nThis was a DRY RUN. Run with --fix to apply changes.");
  }
  process.exit(0);
}

async function backfillForTenant(tenantCompanyId: string, dryRun: boolean): Promise<Summary> {
  const summary: Summary = { totalScanned: 0, updatedNulls: 0, updatedMismatches: 0, skipped: 0, errors: [] };

  // Fetch all active quotes for this tenant that need attention:
  // 1. customerCompanyId IS NULL
  // 2. customerCompanyId doesn't match location.parentCompanyId
  const allQuotes = await db
    .select({
      quoteId: quotes.id,
      quoteNumber: quotes.quoteNumber,
      locationId: quotes.locationId,
      customerCompanyId: quotes.customerCompanyId,
    })
    .from(quotes)
    .where(
      and(
        eq(quotes.companyId, tenantCompanyId),
        eq(quotes.isActive, true),
      )
    );

  summary.totalScanned = allQuotes.length;

  for (const q of allQuotes) {
    try {
      // Skip quotes with no location (can't resolve)
      if (!q.locationId) {
        if (!q.customerCompanyId) {
          summary.skipped++;
          console.log(`  SKIP quote ${q.quoteNumber ?? q.quoteId}: no locationId, no customerCompanyId`);
        }
        continue;
      }

      // Load the location
      const [location] = await db
        .select()
        .from(clientLocations)
        .where(
          and(
            eq(clientLocations.id, q.locationId),
            eq(clientLocations.companyId, tenantCompanyId),
          )
        )
        .limit(1);

      if (!location) {
        if (!q.customerCompanyId) {
          summary.skipped++;
          console.log(`  SKIP quote ${q.quoteNumber ?? q.quoteId}: location ${q.locationId} not found`);
        }
        continue;
      }

      // Resolve the correct customerCompanyId for this location
      const resolvedId = await resolveCustomerCompanyForLocation(tenantCompanyId, location);

      // Case 1: quote.customerCompanyId is NULL
      if (!q.customerCompanyId) {
        if (dryRun) {
          console.log(`  WOULD SET quote ${q.quoteNumber ?? q.quoteId}: NULL → ${resolvedId}`);
        } else {
          await db
            .update(quotes)
            .set({ customerCompanyId: resolvedId })
            .where(eq(quotes.id, q.quoteId));
          console.log(`  SET quote ${q.quoteNumber ?? q.quoteId}: NULL → ${resolvedId}`);
        }
        summary.updatedNulls++;
        continue;
      }

      // Case 2: quote.customerCompanyId doesn't match location's resolved parent
      if (q.customerCompanyId !== resolvedId) {
        if (dryRun) {
          console.log(`  WOULD FIX quote ${q.quoteNumber ?? q.quoteId}: ${q.customerCompanyId} → ${resolvedId}`);
        } else {
          await db
            .update(quotes)
            .set({ customerCompanyId: resolvedId })
            .where(eq(quotes.id, q.quoteId));
          console.log(`  FIXED quote ${q.quoteNumber ?? q.quoteId}: ${q.customerCompanyId} → ${resolvedId}`);
        }
        summary.updatedMismatches++;
        continue;
      }

      // Already correct — no action needed
    } catch (err: any) {
      const msg = `Error on quote ${q.quoteNumber ?? q.quoteId}: ${err.message}`;
      summary.errors.push(msg);
      console.error(`  ERROR: ${msg}`);
    }
  }

  if (summary.updatedNulls > 0 || summary.updatedMismatches > 0 || summary.skipped > 0) {
    console.log(`Tenant ${tenantCompanyId}: ${summary.updatedNulls} nulls, ${summary.updatedMismatches} mismatches, ${summary.skipped} skipped`);
  }

  return summary;
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
