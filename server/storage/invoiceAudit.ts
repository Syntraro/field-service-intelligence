/**
 * Legacy Invoice Audit - READ-ONLY
 *
 * Audits existing invoices for billing integrity issues.
 * Does NOT modify any data.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { invoices } from "@shared/schema";

export interface InvoiceAuditResult {
  totals: {
    invoicesAudited: number;
    missingCustomerCompany: number;
    invalidLocation: number;
    billingMismatch: number;
    jobLocationMismatch: number;
  };
  samples: {
    missingCustomerCompany: Array<{
      invoiceId: string;
      invoiceNumber: string | null;
      locationId: string;
      locationCompanyName: string | null;
      locationParentCompanyId: string | null;
    }>;
    invalidLocation: Array<{
      invoiceId: string;
      invoiceNumber: string | null;
      locationId: string | null;
      locationExists: boolean;
    }>;
    billingMismatch: Array<{
      invoiceId: string;
      invoiceNumber: string | null;
      invoiceCustomerCompanyId: string;
      locationParentCompanyId: string;
      invoiceCustomerCompanyName: string | null;
      locationParentCompanyName: string | null;
    }>;
    jobLocationMismatch: Array<{
      invoiceId: string;
      invoiceNumber: string | null;
      jobId: string;
      jobNumber: number;
      invoiceLocationId: string;
      jobLocationId: string;
    }>;
  };
}

const SAMPLE_LIMIT = 10; // Max samples per issue type

/**
 * Run a read-only audit of all invoices for billing integrity issues.
 * Groups results by issue type and returns structured report.
 */
export async function runLegacyInvoiceAudit(): Promise<InvoiceAuditResult> {
  console.log("\n========================================");
  console.log("LEGACY INVOICE AUDIT - READ ONLY");
  console.log("========================================\n");

  // Get total invoice count
  const [{ total: invoicesAudited }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(invoices);

  console.log(`Total invoices to audit: ${invoicesAudited}\n`);

  // 1) Missing customerCompanyId
  // Find invoices where customerCompanyId IS NULL but should be populated
  // 2026-05-01 bypass cleanup: locationCompanyName resolves via the
  // canonical parent-first COALESCE so the audit sample displays the
  // same name a user sees on the Invoice Detail page.
  const missingCustomerCompanyResults = await db.execute(sql`
    SELECT
      i.id as "invoiceId",
      i.invoice_number as "invoiceNumber",
      i.location_id as "locationId",
      COALESCE(cc.name, NULLIF(cl.company_name, '')) as "locationCompanyName",
      cl.parent_company_id as "locationParentCompanyId"
    FROM invoices i
    LEFT JOIN client_locations cl ON i.location_id = cl.id
    LEFT JOIN customer_companies cc ON cl.parent_company_id = cc.id
    WHERE i.customer_company_id IS NULL
      AND i.is_active = true
    ORDER BY i.created_at DESC
    LIMIT ${SAMPLE_LIMIT}
  `);

  const missingCustomerCompanyCountResult = await db.execute(sql`
    SELECT count(*)::int as count
    FROM invoices i
    WHERE i.customer_company_id IS NULL
      AND i.is_active = true
  `);
  const missingCustomerCompanyCount = (missingCustomerCompanyCountResult.rows[0] as any)?.count ?? 0;

  // 2) Broken location references
  // Invoices where locationId IS NULL OR locationId does not exist in client_locations
  const invalidLocationResults = await db.execute(sql`
    SELECT
      i.id as "invoiceId",
      i.invoice_number as "invoiceNumber",
      i.location_id as "locationId",
      CASE WHEN cl.id IS NOT NULL THEN true ELSE false END as "locationExists"
    FROM invoices i
    LEFT JOIN client_locations cl ON i.location_id = cl.id
    WHERE i.is_active = true
      AND (i.location_id IS NULL OR cl.id IS NULL)
    ORDER BY i.created_at DESC
    LIMIT ${SAMPLE_LIMIT}
  `);

  const invalidLocationCountResult = await db.execute(sql`
    SELECT count(*)::int as count
    FROM invoices i
    LEFT JOIN client_locations cl ON i.location_id = cl.id
    WHERE i.is_active = true
      AND (i.location_id IS NULL OR cl.id IS NULL)
  `);
  const invalidLocationCount = (invalidLocationCountResult.rows[0] as any)?.count ?? 0;

  // 3) Billing mismatch
  // Invoices where invoice.customerCompanyId != location.parentCompanyId (both non-null)
  const billingMismatchResults = await db.execute(sql`
    SELECT
      i.id as "invoiceId",
      i.invoice_number as "invoiceNumber",
      i.customer_company_id as "invoiceCustomerCompanyId",
      cl.parent_company_id as "locationParentCompanyId",
      cc_invoice.name as "invoiceCustomerCompanyName",
      cc_location.name as "locationParentCompanyName"
    FROM invoices i
    INNER JOIN client_locations cl ON i.location_id = cl.id
    LEFT JOIN customer_companies cc_invoice ON i.customer_company_id = cc_invoice.id
    LEFT JOIN customer_companies cc_location ON cl.parent_company_id = cc_location.id
    WHERE i.is_active = true
      AND i.customer_company_id IS NOT NULL
      AND cl.parent_company_id IS NOT NULL
      AND i.customer_company_id != cl.parent_company_id
    ORDER BY i.created_at DESC
    LIMIT ${SAMPLE_LIMIT}
  `);

  const billingMismatchCountResult = await db.execute(sql`
    SELECT count(*)::int as count
    FROM invoices i
    INNER JOIN client_locations cl ON i.location_id = cl.id
    WHERE i.is_active = true
      AND i.customer_company_id IS NOT NULL
      AND cl.parent_company_id IS NOT NULL
      AND i.customer_company_id != cl.parent_company_id
  `);
  const billingMismatchCount = (billingMismatchCountResult.rows[0] as any)?.count ?? 0;

  // 4) Job-linked invoice location mismatch
  // For invoices with jobId: verify job.locationId matches invoice.locationId
  const jobLocationMismatchResults = await db.execute(sql`
    SELECT
      i.id as "invoiceId",
      i.invoice_number as "invoiceNumber",
      i.job_id as "jobId",
      j.job_number as "jobNumber",
      i.location_id as "invoiceLocationId",
      j.location_id as "jobLocationId"
    FROM invoices i
    INNER JOIN jobs j ON i.job_id = j.id
    WHERE i.is_active = true
      AND i.job_id IS NOT NULL
      AND i.location_id IS NOT NULL
      AND j.location_id IS NOT NULL
      AND i.location_id != j.location_id
    ORDER BY i.created_at DESC
    LIMIT ${SAMPLE_LIMIT}
  `);

  const jobLocationMismatchCountResult = await db.execute(sql`
    SELECT count(*)::int as count
    FROM invoices i
    INNER JOIN jobs j ON i.job_id = j.id
    WHERE i.is_active = true
      AND i.job_id IS NOT NULL
      AND i.location_id IS NOT NULL
      AND j.location_id IS NOT NULL
      AND i.location_id != j.location_id
  `);
  const jobLocationMismatchCount = (jobLocationMismatchCountResult.rows[0] as any)?.count ?? 0;

  // Build audit result
  const result: InvoiceAuditResult = {
    totals: {
      invoicesAudited,
      missingCustomerCompany: Number(missingCustomerCompanyCount),
      invalidLocation: Number(invalidLocationCount),
      billingMismatch: Number(billingMismatchCount),
      jobLocationMismatch: Number(jobLocationMismatchCount),
    },
    samples: {
      missingCustomerCompany: missingCustomerCompanyResults.rows as any[],
      invalidLocation: invalidLocationResults.rows as any[],
      billingMismatch: billingMismatchResults.rows as any[],
      jobLocationMismatch: jobLocationMismatchResults.rows as any[],
    },
  };

  // Log summary
  console.log("========== AUDIT SUMMARY ==========\n");
  console.log(`Invoices audited:         ${result.totals.invoicesAudited}`);
  console.log(`Missing customerCompanyId: ${result.totals.missingCustomerCompany}`);
  console.log(`Invalid location ref:      ${result.totals.invalidLocation}`);
  console.log(`Billing mismatch:          ${result.totals.billingMismatch}`);
  console.log(`Job-location mismatch:     ${result.totals.jobLocationMismatch}`);
  console.log("\n===================================\n");

  // Log samples if issues found
  if (result.totals.missingCustomerCompany > 0) {
    console.log("--- Missing customerCompanyId (samples) ---");
    result.samples.missingCustomerCompany.forEach((s, i) => {
      console.log(`  ${i + 1}. Invoice #${s.invoiceNumber || s.invoiceId.slice(0, 8)}`);
      console.log(`     Location: ${s.locationCompanyName || "N/A"}`);
      console.log(`     Parent Company ID: ${s.locationParentCompanyId || "NULL"}`);
    });
    console.log("");
  }

  if (result.totals.invalidLocation > 0) {
    console.log("--- Invalid Location References (samples) ---");
    result.samples.invalidLocation.forEach((s, i) => {
      console.log(`  ${i + 1}. Invoice #${s.invoiceNumber || s.invoiceId.slice(0, 8)}`);
      console.log(`     locationId: ${s.locationId || "NULL"}`);
      console.log(`     Location exists: ${s.locationExists}`);
    });
    console.log("");
  }

  if (result.totals.billingMismatch > 0) {
    console.log("--- Billing Mismatch (samples) ---");
    result.samples.billingMismatch.forEach((s, i) => {
      console.log(`  ${i + 1}. Invoice #${s.invoiceNumber || s.invoiceId.slice(0, 8)}`);
      console.log(`     Invoice billed to: ${s.invoiceCustomerCompanyName} (${s.invoiceCustomerCompanyId.slice(0, 8)})`);
      console.log(`     Location parent:   ${s.locationParentCompanyName} (${s.locationParentCompanyId.slice(0, 8)})`);
    });
    console.log("");
  }

  if (result.totals.jobLocationMismatch > 0) {
    console.log("--- Job-Location Mismatch (samples) ---");
    result.samples.jobLocationMismatch.forEach((s, i) => {
      console.log(`  ${i + 1}. Invoice #${s.invoiceNumber || s.invoiceId.slice(0, 8)}`);
      console.log(`     Job #${s.jobNumber}`);
      console.log(`     Invoice locationId: ${s.invoiceLocationId.slice(0, 8)}`);
      console.log(`     Job locationId:     ${s.jobLocationId.slice(0, 8)}`);
    });
    console.log("");
  }

  const totalIssues =
    result.totals.missingCustomerCompany +
    result.totals.invalidLocation +
    result.totals.billingMismatch +
    result.totals.jobLocationMismatch;

  if (totalIssues === 0) {
    console.log("✓ No billing integrity issues found.\n");
  } else {
    console.log(`⚠ Found ${totalIssues} total issues across all categories.\n`);
  }

  return result;
}
