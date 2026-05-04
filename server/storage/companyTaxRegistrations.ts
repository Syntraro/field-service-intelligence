/**
 * Company Tax Registrations — repository (2026-05-03).
 *
 * Tenant-level multi-row tax registration identity for customer-facing
 * invoices. See `shared/schema.ts::companyTaxRegistrations` for the full
 * column-level rationale.
 *
 * Two operations only:
 *   • `list(tenantId)`     — fetch all rows for a tenant, ordered by
 *                            sortOrder ASC then createdAt ASC for
 *                            tie-breaking.
 *   • `replace(tenantId, list)` — replace-all semantics. Deletes every
 *                                 existing row for the tenant inside a
 *                                 transaction, then inserts the supplied
 *                                 list with sort_order = 0..N-1 in input
 *                                 order. Empty list → no rows for the
 *                                 tenant (PDF renders no tax-registration
 *                                 lines, matching the existing-tenant
 *                                 default).
 *
 * Replace-all is the simplest semantic for a small, hand-edited list
 * (caps at ~5 entries per company in practice). It removes any
 * partial-update / id-tracking complexity from the route layer.
 *
 * UNRELATED to the tax-RATE calculation engine — see the matching
 * comment on the schema table.
 */
import { db } from "../db";
import { asc, eq } from "drizzle-orm";
import { companyTaxRegistrations } from "@shared/schema";

export interface TaxRegistrationRow {
  id: string;
  label: string | null;
  number: string;
  sortOrder: number;
}

export interface ReplaceTaxRegistrationInput {
  /** Optional jurisdiction label (e.g. "HST", "GST", "VAT"). Empty
   *  string is normalized to `null` so the PDF falls back to the
   *  literal "Tax ID" prefix. */
  label?: string | null;
  /** Required registration number. Must be non-empty after trim —
   *  `replace()` rejects empty entries. */
  number: string;
}

export const companyTaxRegistrationRepository = {
  /**
   * List every tax registration for a tenant in presentation order.
   * Empty array if the tenant has none.
   */
  async list(tenantId: string): Promise<TaxRegistrationRow[]> {
    const rows = await db
      .select({
        id: companyTaxRegistrations.id,
        label: companyTaxRegistrations.label,
        number: companyTaxRegistrations.number,
        sortOrder: companyTaxRegistrations.sortOrder,
      })
      .from(companyTaxRegistrations)
      .where(eq(companyTaxRegistrations.companyId, tenantId))
      .orderBy(
        asc(companyTaxRegistrations.sortOrder),
        asc(companyTaxRegistrations.createdAt),
      );

    return rows.map((r) => ({
      id: r.id,
      label: r.label ?? null,
      number: r.number,
      sortOrder: r.sortOrder,
    }));
  },

  /**
   * Replace every tax registration for a tenant with the supplied
   * list. Atomic: a failure mid-write rolls back to the prior list.
   *
   *  • Trims `label` and `number`; empty `label` is stored as NULL.
   *  • Skips entries whose trimmed `number` is empty (a registration
   *    with no number has nothing to render on the PDF).
   *  • Reassigns `sortOrder` to 0..N-1 based on input order.
   *  • Empty input list → table cleared for the tenant.
   */
  async replace(
    tenantId: string,
    input: ReplaceTaxRegistrationInput[],
  ): Promise<TaxRegistrationRow[]> {
    const cleaned = input
      .map((row) => {
        const labelRaw = row.label ?? "";
        const numberRaw = row.number ?? "";
        const labelTrimmed = labelRaw.trim();
        const numberTrimmed = numberRaw.trim();
        return {
          label: labelTrimmed.length > 0 ? labelTrimmed : null,
          number: numberTrimmed,
        };
      })
      .filter((row) => row.number.length > 0);

    await db.transaction(async (tx) => {
      await tx
        .delete(companyTaxRegistrations)
        .where(eq(companyTaxRegistrations.companyId, tenantId));

      if (cleaned.length === 0) return;

      await tx.insert(companyTaxRegistrations).values(
        cleaned.map((row, idx) => ({
          companyId: tenantId,
          label: row.label,
          number: row.number,
          sortOrder: idx,
        })),
      );
    });

    return this.list(tenantId);
  },

  /**
   * Tenant-scoped deletion guard for cross-tenant safety: the route
   * layer already filters by `req.companyId`, but this helper
   * double-checks ownership before any single-row mutation. Currently
   * unused by the API surface (replace-all is the canonical writer)
   * but kept as a documented escape hatch for ad-hoc admin tooling.
   */
  async deleteAllForTenant(tenantId: string): Promise<void> {
    await db
      .delete(companyTaxRegistrations)
      .where(eq(companyTaxRegistrations.companyId, tenantId));
  },
};
