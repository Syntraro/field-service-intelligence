/**
 * PM Job Parts Copy Service
 *
 * Copies location PM part templates into job_parts for a generated PM job.
 * Snapshot at generation time: prices/descriptions are frozen from the items catalog.
 *
 * Idempotency: skips copy if the job already has any active job_parts rows.
 */

import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { jobParts } from "@shared/schema";
import { pmPartRepository, type PMPartWithItem } from "../storage/pmParts";

/** Drizzle transaction type — same shape as `db` for query compatibility */
type DbOrTx = typeof db;

/**
 * Copy location PM part templates into job_parts for a given job.
 *
 * Transactional: if `tx` is provided, all queries run within it.
 * Otherwise the function wraps its own work in a transaction.
 *
 * Uses bulk `INSERT` directly on jobParts (not storage.createJobPart) because:
 * - The target job was just created during generation and cannot be invoiced,
 *   so createJobPart's invoice-guard and job-existence checks are redundant.
 * - A single bulk INSERT is far more efficient than N individual inserts.
 *
 * @param companyId  - Tenant company ID
 * @param locationId - Location to read PM part templates from
 * @param jobId      - Target job to insert parts into
 * @param tx         - Optional Drizzle transaction to run within
 * @returns Number of job_parts rows inserted (0 if skipped or no templates)
 */
export async function copyLocationPMPartsToJob(
  companyId: string,
  locationId: string,
  jobId: string,
  tx?: DbOrTx,
): Promise<number> {
  // Load templates with joined item data (includes itemUnitPrice)
  const templates: PMPartWithItem[] = await pmPartRepository.getLocationPMParts(companyId, locationId);

  if (templates.length === 0) {
    return 0;
  }

  // Core logic: idempotency check + bulk insert
  const doInsert = async (queryDb: DbOrTx): Promise<number> => {
    // Idempotency: skip if job already has any active parts
    const [existingPart] = await queryDb
      .select({ id: jobParts.id })
      .from(jobParts)
      .where(
        and(
          eq(jobParts.companyId, companyId),
          eq(jobParts.jobId, jobId),
          eq(jobParts.isActive, true),
        )
      )
      .limit(1);

    if (existingPart) {
      return 0; // Job already has parts — skip to prevent duplication
    }

    // Build insert rows from templates (snapshot prices at generation time)
    const rows = templates.map((t, index) => ({
      companyId,
      jobId,
      productId: t.productId,
      equipmentId: t.equipmentId ?? null,
      description: t.descriptionOverride ?? t.itemName ?? "",
      quantity: t.quantityPerVisit,
      unitCost: t.itemCost ?? null,
      unitPrice: t.itemUnitPrice ?? null,
      equipmentLabel: t.equipmentLabel ?? null,
      sortOrder: index,
    }));

    // Bulk insert all parts in one statement
    await queryDb.insert(jobParts).values(rows);
    return rows.length;
  };

  // If caller provided a transaction, use it; otherwise wrap in our own
  if (tx) {
    return doInsert(tx);
  }
  return db.transaction(async (innerTx) => doInsert(innerTx as unknown as DbOrTx));
}
