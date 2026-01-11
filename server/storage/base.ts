import { db } from "../db";
import { and, eq } from "drizzle-orm";
import { validate as isUUID } from "uuid";

/**
 * Base repository helpers for tenant isolation and safety.
 *
 * IMPORTANT:
 * - All domain repositories must scope reads/writes by companyId.
 * - NEVER query by id alone for tenant-owned resources.
 */
export class BaseRepository {
  /**
   * Defensive guard: companyId must always be present.
   * This prevents accidental global queries if middleware wiring breaks.
   */
  protected assertCompanyId(companyId: string): void {
    if (!companyId || typeof companyId !== "string") {
      throw new Error("Tenant context missing (companyId)");
    }
  }

  /**
   * Validate that a string is a valid UUID.
   * Prevents injection attacks and invalid ID formats.
   */
  protected validateUUID(value: string, fieldName: string = "id"): void {
    if (!isUUID(value)) {
      const err = new Error(`Invalid ${fieldName} format`);
      (err as any).statusCode = 400;
      throw err;
    }
  }

  /**
   * Ensures a record belongs to the specified company.
   * Throwing a 404-equivalent error avoids leaking existence across tenants.
   */
  protected validateTenantOwnership<T extends { companyId: string }>(
    record: T | null,
    companyId: string,
    resourceName: string
  ): T {
    this.assertCompanyId(companyId);

    if (!record || record.companyId !== companyId) {
      // Routes should catch this and return 404.
      throw this.notFoundError(resourceName);
    }

    return record;
  }

  /**
   * Helper for common (id + companyId) lookups with validation.
   */
  protected whereIdAndCompany<TTable extends { id: any; companyId: any }>(
    table: TTable,
    id: string,
    companyId: string
  ) {
    this.assertCompanyId(companyId);
    this.validateUUID(id, "id");
    return and(eq((table as any).id, id), eq((table as any).companyId, companyId));
  }

  /**
   * Run a unit of work in a DB transaction.
   */
  protected async tx<T>(fn: (txDb: typeof db) => Promise<T>): Promise<T> {
    return db.transaction(async (txDb) => fn(txDb as any));
  }

  /**
   * Standard error creators for consistent HTTP responses
   */
  protected notFoundError(resourceName: string): Error {
    const err = new Error(`${resourceName} not found`);
    (err as any).statusCode = 404;
    return err;
  }

  protected validationError(message: string): Error {
    const err = new Error(message);
    (err as any).statusCode = 400;
    return err;
  }

  protected forbiddenError(message: string = "Forbidden"): Error {
    const err = new Error(message);
    (err as any).statusCode = 403;
    return err;
  }

  protected conflictError(message: string): Error {
    const err = new Error(message);
    (err as any).statusCode = 409;
    return err;
  }

  /**
   * MIGRATION GUARD: Validate locationId/clientId consistency.
   * During the clientId → locationId migration, both columns should have the same value.
   * This guard catches data inconsistencies early.
   * TODO: [MIGRATION] Remove once clientId is fully deprecated
   */
  protected assertLocationIdConsistency(
    record: { locationId?: string | null; clientId?: string | null },
    context: string = "record"
  ): void {
    const { locationId, clientId } = record;
    // If both are present and different, log a warning
    if (locationId && clientId && locationId !== clientId) {
      console.warn(
        `[MIGRATION WARNING] locationId/clientId mismatch in ${context}: ` +
        `locationId=${locationId}, clientId=${clientId}. ` +
        `These should be equal during migration.`
      );
    }
  }
}

/**
 * Parse decimals coming from DB/user input safely.
 * Returns a string (to avoid floating precision in money values).
 */
export function parseDecimal(value: string | null | undefined, defaultValue = "0"): string {
  if (!value) return defaultValue;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(value) : defaultValue;
}

/**
 * Format date to ISO date string (YYYY-MM-DD). Returns null if invalid.
 */
export function formatDateOnly(date: Date | string | null): string | null {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Helper for safe text search patterns (avoids wildcard injection / runaway LIKE scans).
 */
export function escapeLike(str: string): string {
  // Normalize Unicode quotes to ASCII
  const normalized = str
    .replace(/[\u2018\u2019]/g, "'")  // ' and ' -> '
    .replace(/[\u201C\u201D]/g, '"'); // " and " -> "
  
  // Escape SQL LIKE wildcards
  return normalized.replace(/[%_]/g, "\\$&");
}

/**
 * Helper for paginated queries.
 */
export function clampLimit(limit: number, max = 200): number {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.min(Math.floor(n), max);
}

export function clampOffset(offset: number): number {
  const n = Number(offset);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

export function normalizeSearchTerm(input: string) {
  return input
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * MIGRATION GUARD: Validate locationId/clientId consistency for arrays of records.
 * Logs warnings for any records where locationId !== clientId.
 * TODO: [MIGRATION] Remove once clientId is fully deprecated
 */
export function validateLocationIdConsistencyBatch<T extends { locationId?: string | null; clientId?: string | null }>(
  records: T[],
  context: string = "records"
): void {
  for (const record of records) {
    const { locationId, clientId } = record;
    if (locationId && clientId && locationId !== clientId) {
      console.warn(
        `[MIGRATION WARNING] locationId/clientId mismatch in ${context}: ` +
        `locationId=${locationId}, clientId=${clientId}`
      );
    }
  }
}

/**
 * MIGRATION HELPER: Log deprecation warning for clientId-only code paths.
 * Call this in code paths that should eventually be migrated to use locationId.
 * TODO: [MIGRATION] Remove once clientId is fully deprecated
 */
export function warnClientIdDeprecation(context: string): void {
  if (process.env.NODE_ENV === "development") {
    console.warn(
      `[DEPRECATION] Code path "${context}" uses clientId only. ` +
      `Consider updating to use locationId for future compatibility.`
    );
  }
}
