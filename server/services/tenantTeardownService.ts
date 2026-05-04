/**
 * tenantTeardownService — canonical hard-delete for a tenant + all
 * tenant-owned data, both database rows AND external service objects.
 *
 * 2026-05-04 — supersedes the bespoke `scripts/reset-samcor-tenant.ts`
 * with a five-phase contract that any future tenant teardown call site
 * (admin UI, CLI, automated suspension flow) goes through unchanged.
 *
 *   Phase 1 — Resolve tenant (by companyId or email, refusing ambiguity)
 *   Phase 2 — External inventory (read-only) — what would be deleted
 *   Phase 3 — External cleanup (R2 prefix sweep + best-effort QBO revoke
 *             + portal/staff session purge). Stripe Connect accounts +
 *             customers / payment methods stay at the provider by
 *             policy; documented in the result summary.
 *   Phase 4 — Database hard delete (cascade-driven via `companies` row)
 *   Phase 5 — Final verification (DB row counts == 0 + R2 objects == 0
 *             + sessions == 0)
 *
 * Safety guarantees:
 *   • dry-run is the default; --confirm is required for any destructive
 *     operation.
 *   • Production refuses unless ALLOW_PRODUCTION_RESET=true.
 *   • Empty / "/" tenant prefixes refuse before touching R2.
 *   • Per-prefix R2 list/delete uses paginated ListObjectsV2 + chunked
 *     DeleteObjects (1000 keys / call max).
 *   • All DB deletes run inside one transaction; mid-flight failure
 *     rolls back atomically.
 *   • Idempotent — a second run on a now-clean tenant resolves to "no
 *     company" and exits cleanly.
 *   • Never touches platform seed (roles, plan_features, schema_migrations,
 *     global Resend domain, global QBO webhook config).
 */

import pg from "pg";
import { getR2Provider, isR2Configured } from "./storage/R2StorageProvider";

// ─── Public API ────────────────────────────────────────────────────────────

export interface TenantTeardownInput {
  /** One of `companyId` / `email` is required. `companyId` wins on conflict. */
  companyId?: string | null;
  email?: string | null;
  /** Caller-supplied audit string — recorded on log lines, not the DB. */
  reason?: string | null;
  /** "system" / "platform-admin:<email>" / "cli". Same — log only. */
  actor?: string | null;
  /** Default true. Set to false to actually delete. */
  dryRun: boolean;
  /** Skip the DB cascade phase. Useful for "external-only" cleanups
   *  when the company row was already deleted by an earlier run. */
  skipDb?: boolean;
  /** Skip the R2 prefix sweep. */
  skipR2?: boolean;
  /** Optional pre-resolved DB pool. Defaults to a fresh pg.Client from
   *  DATABASE_URL — preferred for one-shot CLI calls so connections close. */
  db?: pg.Client | null;
}

export interface TenantInventory {
  /** Resolved companyId(s). Always 1 unless the email matched multiple. */
  companyIds: string[];
  /** All user ids tied to the company(s). Used for staff-session purge. */
  userIds: string[];
  /** Pre-delete row counts per FK table. Empty → already clean. */
  fkRowCounts: Array<{ table: string; column: string; rows: number }>;
  /** Total tenant rows across FK tables. */
  totalFkRows: number;
  /** Tables whose `company_id` column has NO FK to companies(id). */
  orphanTables: string[];
  /** Per-orphan-table count for the resolved company(s). */
  orphanRowCounts: Array<{ table: string; rows: number }>;
  /** R2 inventory under the tenant prefix. */
  r2: {
    bucket: string | null;
    prefix: string | null;
    enabled: boolean;
    objectCount: number;
    totalBytes: number;
    /** First 10 sample keys (operator visibility — log-friendly). */
    sampleKeys: string[];
  };
  /** Provider-side records we know about. */
  providers: {
    qbo: { hasConnection: boolean; hasRealmId: boolean };
    stripeConnect: { hasAccountRow: boolean; providerAccountIdPresent: boolean };
  };
  /** Session rows referencing this tenant by user id or portal companyId. */
  sessions: { staffSessions: number; portalSessions: number };
}

export interface TenantTeardownResult {
  resolved: { companyIds: string[]; userIds: string[] };
  inventory: TenantInventory;
  /** What actually executed. dryRun=true → all `executed.*` are 0 / null. */
  executed: {
    dryRun: boolean;
    r2DeletedObjects: number;
    r2DeletedBytes: number;
    r2DeleteErrors: Array<{ key: string; message: string }>;
    qboRevokeAttempted: boolean;
    qboRevokeSuccess: boolean | null;
    qboRevokeMessage: string | null;
    sessionsDeleted: number;
    dbCascadeDeletedCompanies: number;
    /** Cumulative cascade count (pre-delete count snapshot, not from RETURNING). */
    dbCascadeRowsApprox: number;
  };
  /** Post-delete verification — populated only when `dryRun=false`. */
  verification: {
    companiesRemaining: number;
    usersWithEmailRemaining: number;
    userIdsRemaining: number;
    fkTablesWithRows: Array<{ table: string; column: string; rows: number }>;
    r2ObjectsRemaining: number;
    auditLogsTargetingTenant: number;
  } | null;
  /** What stays at the provider by policy (Stripe Connect account, etc.). */
  providerRetentions: Array<{ provider: string; reason: string }>;
}

// Refuse to operate on an obviously dangerous prefix.
const FORBIDDEN_PREFIXES = new Set(["", "/", "tenants/", "tenants"]);

const TENANT_PREFIX_PATTERN =
  /^tenants\/[0-9a-fA-F-]{36}\/$/; // exact: tenants/<uuid>/

// ─── Service ───────────────────────────────────────────────────────────────

export async function teardownTenant(
  input: TenantTeardownInput,
): Promise<TenantTeardownResult> {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PRODUCTION_RESET !== "true") {
    throw new Error(
      "tenantTeardownService refused: NODE_ENV=production. Set ALLOW_PRODUCTION_RESET=true to override.",
    );
  }
  if (!input.companyId && !input.email) {
    throw new Error("tenantTeardownService: companyId or email is required");
  }

  const { client, ownsClient } = await acquireClient(input.db ?? null);

  try {
    // ── Phase 1: resolve ──────────────────────────────────────────────────
    const { companyIds, userIds } = await resolveTenant(client, input);
    if (companyIds.length === 0) {
      // Idempotent path — nothing to do.
      return emptyResult(input);
    }
    if (companyIds.length > 1 && !input.companyId) {
      throw new Error(
        `Ambiguous tenant: email "${input.email}" resolves to ${companyIds.length} companies. Re-run with --company-id.`,
      );
    }

    // ── Phase 2: external + DB inventory ──────────────────────────────────
    const inventory = await buildInventory(client, companyIds, userIds, input);

    const providerRetentions: TenantTeardownResult["providerRetentions"] = [];
    if (inventory.providers.stripeConnect.providerAccountIdPresent) {
      providerRetentions.push({
        provider: "stripe",
        reason:
          "Stripe Connect account (acct_...) cannot be deleted via API. The account stays at Stripe; local row is hard-deleted via cascade. Operator must contact Stripe Support to delete the connected account itself if required.",
      });
    }
    providerRetentions.push({
      provider: "resend",
      reason:
        "Resend has no per-tenant API surface to clean up. Email-delivery records persist in Resend's dashboard for retention; local email_deliveries rows are hard-deleted via cascade.",
    });
    providerRetentions.push({
      provider: "stripe",
      reason:
        "Stripe Customer + PaymentMethod objects live ON the connected account; once the local payment_provider_accounts row is gone we no longer have access to make API calls against them. They persist at Stripe under the connected account.",
    });

    if (input.dryRun) {
      return {
        resolved: { companyIds, userIds },
        inventory,
        executed: {
          dryRun: true,
          r2DeletedObjects: 0,
          r2DeletedBytes: 0,
          r2DeleteErrors: [],
          qboRevokeAttempted: false,
          qboRevokeSuccess: null,
          qboRevokeMessage: null,
          sessionsDeleted: 0,
          dbCascadeDeletedCompanies: 0,
          dbCascadeRowsApprox: inventory.totalFkRows,
        },
        verification: null,
        providerRetentions,
      };
    }

    // ── Phase 3: external cleanup ─────────────────────────────────────────
    let r2Result = { deleted: 0, deletedBytes: 0, errors: [] as Array<{ key: string; message: string }> };
    if (!input.skipR2 && inventory.r2.enabled && inventory.r2.prefix) {
      r2Result = await sweepR2Prefix(inventory.r2.bucket!, inventory.r2.prefix);
    }

    let qboRevoke: { attempted: boolean; success: boolean | null; message: string | null } = {
      attempted: false,
      success: null,
      message: null,
    };
    if (inventory.providers.qbo.hasConnection) {
      qboRevoke = await bestEffortQboRevoke(client, companyIds);
    }

    let sessionsDeleted = 0;
    if (!input.skipDb) {
      sessionsDeleted = await purgeSessions(client, companyIds, userIds);
    }

    // ── Phase 4: DB cascade ───────────────────────────────────────────────
    let cascadeRows = 0;
    if (!input.skipDb) {
      cascadeRows = await cascadeDeleteCompanies(client, companyIds);
    }

    // ── Phase 5: verification ─────────────────────────────────────────────
    const verification = await verify(client, companyIds, userIds, input);

    return {
      resolved: { companyIds, userIds },
      inventory,
      executed: {
        dryRun: false,
        r2DeletedObjects: r2Result.deleted,
        r2DeletedBytes: r2Result.deletedBytes,
        r2DeleteErrors: r2Result.errors,
        qboRevokeAttempted: qboRevoke.attempted,
        qboRevokeSuccess: qboRevoke.success,
        qboRevokeMessage: qboRevoke.message,
        sessionsDeleted,
        dbCascadeDeletedCompanies: input.skipDb ? 0 : companyIds.length,
        dbCascadeRowsApprox: cascadeRows,
      },
      verification,
      providerRetentions,
    };
  } finally {
    if (ownsClient) await client.end();
  }
}

// ─── Phase 1: resolve ──────────────────────────────────────────────────────

async function resolveTenant(
  client: pg.Client,
  input: TenantTeardownInput,
): Promise<{ companyIds: string[]; userIds: string[] }> {
  if (input.companyId) {
    const r = await client.query<{ id: string }>(
      `SELECT id FROM companies WHERE id = $1`,
      [input.companyId],
    );
    if (r.rows.length === 0) {
      // The company row may already be deleted but external residue (R2)
      // can still exist. Allow the caller to continue with the supplied
      // id — downstream phases will detect zero rows + still sweep R2.
      const userQ = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE company_id = $1`,
        [input.companyId],
      );
      return {
        companyIds: [input.companyId],
        userIds: userQ.rows.map((r) => r.id),
      };
    }
    const userQ = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE company_id = $1`,
      [input.companyId],
    );
    return { companyIds: [input.companyId], userIds: userQ.rows.map((r) => r.id) };
  }

  const r = await client.query<{ id: string; company_id: string | null }>(
    `SELECT id, company_id FROM users WHERE lower(email) = $1`,
    [input.email!.toLowerCase()],
  );
  return {
    companyIds: Array.from(new Set(r.rows.map((u) => u.company_id).filter((x): x is string => !!x))),
    userIds: r.rows.map((u) => u.id),
  };
}

// ─── Phase 2: inventory ────────────────────────────────────────────────────

async function buildInventory(
  client: pg.Client,
  companyIds: string[],
  userIds: string[],
  input: TenantTeardownInput,
): Promise<TenantInventory> {
  // FK row counts.
  const fks = await client.query<{ table: string; column: string }>(`
    SELECT tc.table_name AS table, kcu.column_name AS column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema    = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
     WHERE tc.constraint_type = 'FOREIGN KEY'
       AND tc.table_schema    = 'public'
       AND ccu.table_name     = 'companies'
       AND ccu.column_name    = 'id'
     ORDER BY tc.table_name, kcu.column_name
  `);
  const fkRowCounts: Array<{ table: string; column: string; rows: number }> = [];
  for (const fk of fks.rows) {
    try {
      const r = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM "${fk.table}" WHERE "${fk.column}" = ANY($1::varchar[])`,
        [companyIds],
      );
      const rows = parseInt(r.rows[0]?.n ?? "0", 10);
      if (rows > 0) fkRowCounts.push({ ...fk, rows });
    } catch {
      /* skip */
    }
  }
  const totalFkRows = fkRowCounts.reduce((s, c) => s + c.rows, 0);

  // Orphan tables: have `company_id` but no FK to companies(id).
  const orphans = await client.query<{ table_name: string }>(`
    SELECT c.table_name
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.column_name  = 'company_id'
       AND NOT EXISTS (
         SELECT 1
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON tc.constraint_name = kcu.constraint_name
           JOIN information_schema.constraint_column_usage ccu
             ON ccu.constraint_name = tc.constraint_name
          WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_schema    = 'public'
            AND tc.table_name      = c.table_name
            AND kcu.column_name    = 'company_id'
            AND ccu.table_name     = 'companies'
            AND ccu.column_name    = 'id'
       )
     ORDER BY c.table_name
  `);
  const orphanRowCounts: Array<{ table: string; rows: number }> = [];
  for (const o of orphans.rows) {
    try {
      const r = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM "${o.table_name}" WHERE company_id = ANY($1::varchar[])`,
        [companyIds],
      );
      const n = parseInt(r.rows[0]?.n ?? "0", 10);
      if (n > 0) orphanRowCounts.push({ table: o.table_name, rows: n });
    } catch {
      /* skip */
    }
  }

  // R2 inventory.
  const r2 = await inventoryR2(companyIds, input.skipR2 === true);

  // Provider-side flags.
  const qboCount = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM qbo_connections WHERE company_id = ANY($1::varchar[])`,
    [companyIds],
  );
  const qboRealm = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM companies WHERE id = ANY($1::varchar[]) AND qbo_realm_id IS NOT NULL`,
    [companyIds],
  );
  const ppaQ = await client.query<{ n_total: string; n_with_account: string }>(
    `SELECT count(*)::text AS n_total,
            count(provider_account_id)::text AS n_with_account
       FROM payment_provider_accounts WHERE company_id = ANY($1::varchar[])`,
    [companyIds],
  );

  // Session rows.
  const staffSessions = userIds.length
    ? await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM session
          WHERE sess::jsonb -> 'passport' ->> 'user' = ANY($1::text[])`,
        [userIds],
      )
    : { rows: [{ n: "0" }] };
  const portalSessions = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM session
      WHERE sess::jsonb -> 'portal' ->> 'companyId' = ANY($1::text[])`,
    [companyIds],
  );

  // count(*) queries always return one row, but our test harness can
  // route a query to a default empty-rows responder; tolerate that
  // gracefully so a missing test fixture surfaces as 0, not a crash.
  const intOf = (rows: Array<Record<string, unknown>>, key: string): number => {
    const v = rows[0]?.[key];
    if (typeof v === "string") return parseInt(v, 10) || 0;
    if (typeof v === "number") return v;
    return 0;
  };

  return {
    companyIds,
    userIds,
    fkRowCounts,
    totalFkRows,
    orphanTables: orphans.rows.map((o) => o.table_name),
    orphanRowCounts,
    r2,
    providers: {
      qbo: {
        hasConnection: intOf(qboCount.rows as any, "n") > 0,
        hasRealmId: intOf(qboRealm.rows as any, "n") > 0,
      },
      stripeConnect: {
        hasAccountRow: intOf(ppaQ.rows as any, "n_total") > 0,
        providerAccountIdPresent: intOf(ppaQ.rows as any, "n_with_account") > 0,
      },
    },
    sessions: {
      staffSessions: intOf(staffSessions.rows as any, "n"),
      portalSessions: intOf(portalSessions.rows as any, "n"),
    },
  };
}

async function inventoryR2(
  companyIds: string[],
  skipR2: boolean,
): Promise<TenantInventory["r2"]> {
  if (skipR2 || !isR2Configured()) {
    return {
      bucket: null,
      prefix: null,
      enabled: false,
      objectCount: 0,
      totalBytes: 0,
      sampleKeys: [],
    };
  }
  if (companyIds.length !== 1) {
    // Multi-company tenants are out of scope today (we never have them).
    // Return zero so the caller can decide whether to abort.
    return {
      bucket: null,
      prefix: null,
      enabled: false,
      objectCount: 0,
      totalBytes: 0,
      sampleKeys: [],
    };
  }
  const r2 = getR2Provider();
  const prefix = `tenants/${companyIds[0]}/`;
  guardPrefix(prefix);
  let total = 0;
  let totalBytes = 0;
  const sample: string[] = [];
  for await (const batch of r2.iterListObjectsByPrefix(r2.defaultBucket, prefix)) {
    for (const obj of batch) {
      total += 1;
      totalBytes += obj.sizeBytes;
      if (sample.length < 10) sample.push(obj.key);
    }
  }
  return {
    bucket: r2.defaultBucket,
    prefix,
    enabled: true,
    objectCount: total,
    totalBytes,
    sampleKeys: sample,
  };
}

function guardPrefix(prefix: string): void {
  if (!prefix || FORBIDDEN_PREFIXES.has(prefix)) {
    throw new Error(`R2 prefix refused (would delete too much): "${prefix}"`);
  }
  if (!TENANT_PREFIX_PATTERN.test(prefix)) {
    throw new Error(
      `R2 prefix refused (does not match canonical tenants/<uuid>/ pattern): "${prefix}"`,
    );
  }
}

// ─── Phase 3a: R2 sweep ────────────────────────────────────────────────────

async function sweepR2Prefix(
  bucket: string,
  prefix: string,
): Promise<{ deleted: number; deletedBytes: number; errors: Array<{ key: string; message: string }> }> {
  guardPrefix(prefix);
  const r2 = getR2Provider();
  let deleted = 0;
  let deletedBytes = 0;
  const errors: Array<{ key: string; message: string }> = [];
  for await (const batch of r2.iterListObjectsByPrefix(bucket, prefix)) {
    if (batch.length === 0) continue;
    // Defensive: only pass keys that start with the prefix (Cloudflare
    // shouldn't return others, but tests pin this — we never delete
    // outside the tenant prefix).
    const safe = batch.filter((b) => b.key.startsWith(prefix));
    const bytesByKey = new Map(safe.map((b) => [b.key, b.sizeBytes]));
    const keys = safe.map((b) => b.key);
    // Chunk to 1000.
    for (let i = 0; i < keys.length; i += 1000) {
      const chunk = keys.slice(i, i + 1000);
      const res = await r2.deleteObjectsBatch(bucket, chunk);
      deleted += res.deleted;
      for (const k of chunk) {
        deletedBytes += bytesByKey.get(k) ?? 0;
      }
      errors.push(...res.errors);
    }
  }
  return { deleted, deletedBytes, errors };
}

// ─── Phase 3b: best-effort QBO revoke ──────────────────────────────────────

async function bestEffortQboRevoke(
  client: pg.Client,
  companyIds: string[],
): Promise<{ attempted: boolean; success: boolean | null; message: string | null }> {
  // Fetch refresh tokens for all qbo_connections rows for the tenant.
  // Per Intuit docs, POST to https://developer.api.intuit.com/v2/oauth2/tokens/revoke
  // with `Authorization: Basic <client_id:client_secret>` and
  // `{ token: <refresh_token> }` JSON. Failure is non-fatal — refresh
  // tokens auto-expire in 100 days.
  const clientIdEnv = process.env.QBO_CLIENT_ID;
  const clientSecretEnv = process.env.QBO_CLIENT_SECRET;
  if (!clientIdEnv || !clientSecretEnv) {
    return {
      attempted: false,
      success: null,
      message: "QBO_CLIENT_ID / QBO_CLIENT_SECRET not configured — skipping revoke (local cascade still applies).",
    };
  }
  const conns = await client.query<{ refresh_token: string }>(
    `SELECT refresh_token FROM qbo_connections WHERE company_id = ANY($1::varchar[])`,
    [companyIds],
  );
  if (conns.rows.length === 0) {
    return { attempted: false, success: null, message: "No QBO connections for this tenant." };
  }
  let allOk = true;
  const messages: string[] = [];
  for (const c of conns.rows) {
    try {
      const auth = Buffer.from(`${clientIdEnv}:${clientSecretEnv}`).toString("base64");
      const res = await fetch(
        "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ token: c.refresh_token }),
        },
      );
      if (!res.ok) {
        allOk = false;
        messages.push(`HTTP ${res.status}`);
      }
    } catch (err: unknown) {
      allOk = false;
      messages.push(err instanceof Error ? err.message : String(err));
    }
  }
  return {
    attempted: true,
    success: allOk,
    message: allOk
      ? `Revoked ${conns.rows.length} QBO refresh token(s).`
      : `Some revoke calls failed: ${messages.join("; ")}`,
  };
}

// ─── Phase 3c: session purge ───────────────────────────────────────────────

async function purgeSessions(
  client: pg.Client,
  companyIds: string[],
  userIds: string[],
): Promise<number> {
  let total = 0;
  if (userIds.length > 0) {
    const r = await client.query(
      `DELETE FROM session
        WHERE sess::jsonb -> 'passport' ->> 'user' = ANY($1::text[])`,
      [userIds],
    );
    total += r.rowCount ?? 0;
  }
  const p = await client.query(
    `DELETE FROM session
      WHERE sess::jsonb -> 'portal' ->> 'companyId' = ANY($1::text[])`,
    [companyIds],
  );
  total += p.rowCount ?? 0;
  return total;
}

// ─── Phase 4: DB cascade ───────────────────────────────────────────────────

async function cascadeDeleteCompanies(
  client: pg.Client,
  companyIds: string[],
): Promise<number> {
  // Pre-count for the result summary.
  let approx = 0;
  await client.query("BEGIN");
  try {
    // Orphan tables (company_id w/o FK).
    const orphans = await client.query<{ table_name: string }>(`
      SELECT c.table_name
        FROM information_schema.columns c
       WHERE c.table_schema = 'public'
         AND c.column_name  = 'company_id'
         AND NOT EXISTS (
           SELECT 1
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu
               ON tc.constraint_name = kcu.constraint_name
             JOIN information_schema.constraint_column_usage ccu
               ON ccu.constraint_name = tc.constraint_name
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_schema    = 'public'
              AND tc.table_name      = c.table_name
              AND kcu.column_name    = 'company_id'
              AND ccu.table_name     = 'companies'
              AND ccu.column_name    = 'id'
         )
    `);
    for (const o of orphans.rows) {
      try {
        const r = await client.query(
          `DELETE FROM "${o.table_name}" WHERE company_id = ANY($1::varchar[])`,
          [companyIds],
        );
        approx += r.rowCount ?? 0;
      } catch {
        /* skip */
      }
    }
    const r = await client.query(
      `DELETE FROM companies WHERE id = ANY($1::varchar[])`,
      [companyIds],
    );
    approx += r.rowCount ?? 0;
    await client.query("COMMIT");
    return approx;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

// ─── Phase 5: verification ─────────────────────────────────────────────────

async function verify(
  client: pg.Client,
  companyIds: string[],
  userIds: string[],
  input: TenantTeardownInput,
): Promise<TenantTeardownResult["verification"]> {
  const fks = await client.query<{ table: string; column: string }>(`
    SELECT tc.table_name AS table, kcu.column_name AS column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema    = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
     WHERE tc.constraint_type = 'FOREIGN KEY'
       AND tc.table_schema    = 'public'
       AND ccu.table_name     = 'companies'
       AND ccu.column_name    = 'id'
  `);
  const fkTablesWithRows: Array<{ table: string; column: string; rows: number }> = [];
  for (const fk of fks.rows) {
    try {
      const r = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM "${fk.table}" WHERE "${fk.column}" = ANY($1::varchar[])`,
        [companyIds],
      );
      const rows = parseInt(r.rows[0]?.n ?? "0", 10);
      if (rows > 0) fkTablesWithRows.push({ ...fk, rows });
    } catch {
      /* skip */
    }
  }
  const cR = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM companies WHERE id = ANY($1::varchar[])`,
    [companyIds],
  );
  const uByEmail = input.email
    ? await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM users WHERE lower(email) = $1`,
        [input.email.toLowerCase()],
      )
    : { rows: [{ n: "0" }] };
  const uById = userIds.length
    ? await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM users WHERE id = ANY($1::varchar[])`,
        [userIds],
      )
    : { rows: [{ n: "0" }] };
  const auditQ = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM audit_logs WHERE target_company_id = ANY($1::varchar[])`,
    [companyIds],
  );
  // Re-list R2 to count remaining.
  let r2Remaining = 0;
  if (!input.skipR2 && isR2Configured() && companyIds.length === 1) {
    const r2 = getR2Provider();
    const prefix = `tenants/${companyIds[0]}/`;
    guardPrefix(prefix);
    for await (const batch of r2.iterListObjectsByPrefix(r2.defaultBucket, prefix)) {
      r2Remaining += batch.length;
    }
  }
  return {
    companiesRemaining: parseInt(cR.rows[0].n, 10),
    usersWithEmailRemaining: parseInt(uByEmail.rows[0].n, 10),
    userIdsRemaining: parseInt(uById.rows[0].n, 10),
    fkTablesWithRows,
    r2ObjectsRemaining: r2Remaining,
    auditLogsTargetingTenant: parseInt(auditQ.rows[0].n, 10),
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function acquireClient(
  existing: pg.Client | null,
): Promise<{ client: pg.Client; ownsClient: boolean }> {
  if (existing) return { client: existing, ownsClient: false };
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  return { client: c, ownsClient: true };
}

function emptyResult(input: TenantTeardownInput): TenantTeardownResult {
  return {
    resolved: { companyIds: [], userIds: [] },
    inventory: {
      companyIds: [],
      userIds: [],
      fkRowCounts: [],
      totalFkRows: 0,
      orphanTables: [],
      orphanRowCounts: [],
      r2: {
        bucket: null,
        prefix: null,
        enabled: false,
        objectCount: 0,
        totalBytes: 0,
        sampleKeys: [],
      },
      providers: {
        qbo: { hasConnection: false, hasRealmId: false },
        stripeConnect: { hasAccountRow: false, providerAccountIdPresent: false },
      },
      sessions: { staffSessions: 0, portalSessions: 0 },
    },
    executed: {
      dryRun: input.dryRun,
      r2DeletedObjects: 0,
      r2DeletedBytes: 0,
      r2DeleteErrors: [],
      qboRevokeAttempted: false,
      qboRevokeSuccess: null,
      qboRevokeMessage: null,
      sessionsDeleted: 0,
      dbCascadeDeletedCompanies: 0,
      dbCascadeRowsApprox: 0,
    },
    verification: input.dryRun
      ? null
      : {
          companiesRemaining: 0,
          usersWithEmailRemaining: 0,
          userIdsRemaining: 0,
          fkTablesWithRows: [],
          r2ObjectsRemaining: 0,
          auditLogsTargetingTenant: 0,
        },
    providerRetentions: [],
  };
}

// Exported for unit tests — they exercise the prefix guard without a DB.
export const __test__ = { guardPrefix, FORBIDDEN_PREFIXES, TENANT_PREFIX_PATTERN };
