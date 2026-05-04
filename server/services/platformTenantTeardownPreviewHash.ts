/**
 * Canonical preview-hash util for the secure tenant-deletion workflow
 * (2026-05-04).
 *
 * The hash binds a deletion REQUEST to the exact teardown PREVIEW the
 * initiator approved. The background executor recomputes the hash
 * against a fresh dry-run preview at execution time and refuses if it
 * drifted — guarantees we don't delete a "different" tenant than what
 * was approved (e.g. someone added a job, an invoice, or a saved card
 * in the gap; we WANT the request to fail closed in that case).
 *
 * Determinism rules:
 *   • SHA-256 hex digest of a CANONICAL JSON form: keys sorted, no
 *     whitespace, primitives JSON-stringified.
 *   • `Date` values normalize to ISO strings.
 *   • `Set` / `Map` are intentionally rejected — the canonicalizer is
 *     designed for the plain JSON shape `tenantTeardownService` already
 *     returns. Catching a non-plain input early surfaces drift faster
 *     than letting `JSON.stringify` silently produce a fragile hash.
 *   • `undefined` properties are dropped (matches JSON.stringify
 *     behaviour) so optional fields don't change the hash.
 *
 * Also exposes a `hashableInventory()` projection that strips
 * non-deterministic / time-varying fields from the full teardown
 * inventory before hashing — the goal is "this tenant's persistent
 * state didn't change," NOT "the wall clock matched."
 */

import { createHash } from "crypto";
import type { TenantInventory } from "./tenantTeardownService";

/**
 * Project a teardown inventory down to the fields that should bind a
 * preview to a deletion request. Drops:
 *   • `r2.sampleKeys`                — first-N sample, order-dependent.
 *   • Any timestamp-like field       — none today, but the rule is here
 *                                       so future additions are explicit.
 *
 * Keeps the canonical "what would be deleted" surface:
 *   • companyIds, userIds (sorted)
 *   • per-table FK row counts (sorted by table)
 *   • orphan rows (sorted)
 *   • r2.{ enabled, bucket, prefix, objectCount, totalBytes }
 *   • providers.{ qbo + stripe boolean flags }
 *   • sessions.{ staff + portal counts }
 */
export interface HashableTenantInventory {
  companyIds: string[];
  userIds: string[];
  fkRowCounts: Array<{ table: string; column: string; rows: number }>;
  totalFkRows: number;
  orphanTables: string[];
  orphanRowCounts: Array<{ table: string; rows: number }>;
  r2: {
    bucket: string | null;
    prefix: string | null;
    enabled: boolean;
    objectCount: number;
    totalBytes: number;
  };
  providers: {
    qbo: { hasConnection: boolean; hasRealmId: boolean };
    stripeConnect: { hasAccountRow: boolean; providerAccountIdPresent: boolean };
  };
  sessions: { staffSessions: number; portalSessions: number };
}

export function hashableInventory(
  inv: TenantInventory,
): HashableTenantInventory {
  const sortByTable = <T extends { table: string }>(arr: T[]): T[] =>
    [...arr].sort((a, b) => a.table.localeCompare(b.table));
  return {
    companyIds: [...inv.companyIds].sort(),
    userIds: [...inv.userIds].sort(),
    fkRowCounts: sortByTable(inv.fkRowCounts),
    totalFkRows: inv.totalFkRows,
    orphanTables: [...inv.orphanTables].sort(),
    orphanRowCounts: sortByTable(inv.orphanRowCounts),
    r2: {
      bucket: inv.r2.bucket,
      prefix: inv.r2.prefix,
      enabled: inv.r2.enabled,
      objectCount: inv.r2.objectCount,
      totalBytes: inv.r2.totalBytes,
    },
    providers: {
      qbo: { ...inv.providers.qbo },
      stripeConnect: { ...inv.providers.stripeConnect },
    },
    sessions: { ...inv.sessions },
  };
}

/**
 * Canonical JSON serialisation: sorted keys, no whitespace, primitives
 * preserved. Used as the input to the SHA-256 digest.
 */
export function canonicalJson(value: unknown): string {
  const stringify = (v: unknown): string => {
    if (v === null) return "null";
    if (v === undefined) return "null";
    if (typeof v === "string") return JSON.stringify(v);
    if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint")
      return String(v);
    if (v instanceof Date) return JSON.stringify(v.toISOString());
    if (Array.isArray(v)) return "[" + v.map(stringify).join(",") + "]";
    if (typeof v === "object") {
      if (v instanceof Set || v instanceof Map) {
        throw new Error("canonicalJson: Set/Map are not supported");
      }
      const keys = Object.keys(v as Record<string, unknown>)
        .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
        .sort();
      return (
        "{" +
        keys
          .map(
            (k) =>
              JSON.stringify(k) +
              ":" +
              stringify((v as Record<string, unknown>)[k]),
          )
          .join(",") +
        "}"
      );
    }
    throw new Error(`canonicalJson: unsupported type ${typeof v}`);
  };
  return stringify(value);
}

export function computePreviewHash(payload: HashableTenantInventory): string {
  const canonical = canonicalJson(payload);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
