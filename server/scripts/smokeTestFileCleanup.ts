/**
 * Smoke test for file_cleanup_queue migration and fileCleanupService.
 * Usage: npx tsx server/scripts/smokeTestFileCleanup.ts
 */

// ─── Built-in imports only (no DATABASE_URL needed) ───────────────────────────
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ─── Load .env synchronously before any app module is imported ────────────────
// db.ts throws at module eval time if DATABASE_URL is absent.
// Dynamic imports inside main() let us set the env var first.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, "../../.env");
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

// ─── Type-only imports — zero runtime cost, used for annotations ──────────────
import type { db as DbType } from "../db";
import type { eq as EqFn, and as AndFn, sql as SqlFn } from "drizzle-orm";
import type { fileCleanupQueue as QueueTable } from "@shared/schema";
import type {
  queueFileCleanupInTx as QueueFn,
  processFileCleanupBatch as BatchFn,
} from "../services/fileCleanupService";

// ─── Runtime module references — populated inside main() ─────────────────────
// eslint-disable-next-line prefer-const
let db: typeof DbType;
let sql: typeof SqlFn;
let eq: typeof EqFn;
let and: typeof AndFn;
let fileCleanupQueue: typeof QueueTable;
let queueFileCleanupInTx: typeof QueueFn;
let processFileCleanupBatch: typeof BatchFn;
let FILE_CLEANUP_MAX_ATTEMPTS: number;

// ─── Harness ──────────────────────────────────────────────────────────────────
const SOURCE_PREFIX = "smoke_test";
let passed = 0;
let failed = 0;

function pass(label: string) { console.log(`  ✓  ${label}`); passed++; }
function fail(label: string, detail?: unknown) { console.error(`  ✗  ${label}`, detail !== undefined ? String(detail) : ""); failed++; }
function assert(cond: boolean, label: string, detail?: unknown) { cond ? pass(label) : fail(label, detail); }

async function getFirstCompanyId(): Promise<string> {
  const rows = await db.execute(sql`SELECT id FROM companies LIMIT 1`);
  const row = (((rows as any).rows ?? (rows as any)))[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error("No companies in DB");
  return row["id"] as string;
}

async function cleanupTestRows() {
  await db.execute(sql`DELETE FROM file_cleanup_queue WHERE source_ref LIKE ${"smoke_test:%"}`);
}

// ─── Test 1: Schema ───────────────────────────────────────────────────────────
async function testSchema() {
  console.log("\n[1] Schema verification");

  const tResult = await db.execute(sql`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='file_cleanup_queue'`);
  const tRows = (((tResult as any).rows ?? (tResult as any)));
  assert(tRows.length > 0, "table file_cleanup_queue exists");

  const cResult = await db.execute(sql`SELECT column_name, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='file_cleanup_queue' ORDER BY ordinal_position`);
  const cols = new Map<string, Record<string, unknown>>(
    (((cResult as any).rows ?? (cResult as any)) as Record<string, unknown>[]).map((row) => {
      return [row["column_name"] as string, row] as [string, Record<string, unknown>];
    }),
  );
  for (const col of ["id","company_id","file_id","bucket","storage_key","storage_provider","source_ref","created_at","processed_at","failed_at","attempt_count","last_error"]) {
    assert(cols.has(col), `column ${col} exists`);
  }
  const attemptDefault = String(cols.get("attempt_count")?.[" column_default"] ?? cols.get("attempt_count")?.["column_default"] ?? "");
  assert(attemptDefault.includes("0"), `attempt_count default=0 (got "${attemptDefault}")`);

  const iResult = await db.execute(sql`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='file_cleanup_queue'`);
  const idxMap = new Map<string, string>(
    (((iResult as any).rows ?? (iResult as any)) as Record<string, unknown>[]).map((row) => {
      return [row["indexname"] as string, row["indexdef"] as string] as [string, string];
    }),
  );

  assert(idxMap.has("file_cleanup_queue_pending_idx"), "pending sweep index exists");
  assert(idxMap.has("file_cleanup_queue_company_idx"), "per-tenant observability index exists");
  assert(idxMap.has("file_cleanup_queue_dedupe_pending_idx"), "deduplication index exists");

  const dedupeIdx: string = idxMap.get("file_cleanup_queue_dedupe_pending_idx") ?? "";
  assert(dedupeIdx.toLowerCase().includes("unique"), "dedupe index is UNIQUE");
  assert(dedupeIdx.includes("company_id"), "dedupe index includes company_id");
  assert(dedupeIdx.includes("bucket"), "dedupe index includes bucket");
  assert(dedupeIdx.includes("storage_key"), "dedupe index includes storage_key");
  assert(
    dedupeIdx.includes("processed_at IS NULL") && dedupeIdx.includes("failed_at IS NULL"),
    "dedupe index partial clause: processed_at IS NULL AND failed_at IS NULL",
  );
}

// ─── Test 2: queueFileCleanupInTx — insert + deduplication ───────────────────
async function testQueueInTx(companyId: string) {
  console.log("\n[2] queueFileCleanupInTx — insert and deduplication");
  const sourceRef = `${SOURCE_PREFIX}:queue_test`;
  const entry = { fileId: "smoke-file-001", bucket: "test-bucket", storageKey: `tenants/${companyId}/smoke/test-001.jpg`, storageProvider: "r2" };

  const r1 = await db.transaction(async (tx) => queueFileCleanupInTx(tx as any, companyId, [entry], sourceRef));
  assert(r1.queued === 1, `first insert: queued=1 (got ${r1.queued})`);
  assert(r1.skipped === 0, `first insert: skipped=0 (got ${r1.skipped})`);

  const r2 = await db.transaction(async (tx) => queueFileCleanupInTx(tx as any, companyId, [entry], sourceRef));
  assert(r2.queued === 0, `duplicate: queued=0 (got ${r2.queued})`);
  assert(r2.skipped === 1, `duplicate: skipped=1 (got ${r2.skipped})`);

  const rows = await db.select().from(fileCleanupQueue)
    .where(and(eq(fileCleanupQueue.companyId, companyId), eq(fileCleanupQueue.sourceRef, sourceRef)));
  assert(rows.length === 1, `exactly 1 row after 2 inserts (got ${rows.length})`);
  assert(rows[0].processedAt === null, "processedAt=NULL");
  assert(rows[0].failedAt === null, "failedAt=NULL");
  assert(rows[0].attemptCount === 0, `attemptCount=0 (got ${rows[0].attemptCount})`);
}

// ─── Test 3: no-op path when R2 not configured ────────────────────────────────
async function testProcessBatchNoR2(companyId: string) {
  console.log("\n[3] processFileCleanupBatch — R2 not configured (no-op)");
  const r2Live = process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET;
  if (r2Live) { console.log("  (skipped — R2 IS configured in this env)"); return; }

  const sourceRef = `${SOURCE_PREFIX}:noop`;
  await db.transaction(async (tx) => queueFileCleanupInTx(
    tx as any, companyId,
    [{ fileId: "smoke-noop", bucket: "test-bucket", storageKey: `tenants/${companyId}/smoke/noop.jpg`, storageProvider: "r2" }],
    sourceRef));

  const result = await processFileCleanupBatch(sourceRef);
  assert(result.processed >= 1, `processed ≥1 (got ${result.processed})`);
  assert(result.errors === 0, `no errors (got ${result.errors})`);

  const [row] = await db.select().from(fileCleanupQueue)
    .where(and(eq(fileCleanupQueue.companyId, companyId), eq(fileCleanupQueue.sourceRef, sourceRef)));
  assert((row?.processedAt ?? null) !== null, "processedAt set after no-op process");
}

// ─── Test 4: attempt_count / failed_at progression ───────────────────────────
async function testAttemptCountAndFailedAt(companyId: string) {
  console.log("\n[4] attempt_count / failed_at progression");
  const sourceRef = `${SOURCE_PREFIX}:attempt_test`;

  const [row] = await db.insert(fileCleanupQueue).values({
    companyId, fileId: "smoke-attempt", bucket: "test-bucket",
    storageKey: `tenants/${companyId}/smoke/attempt.jpg`, storageProvider: "r2", sourceRef,
  }).returning();

  assert(row.attemptCount === 0, "starts with attemptCount=0");
  assert(row.failedAt === null, "starts with failedAt=NULL");

  const belowMax = FILE_CLEANUP_MAX_ATTEMPTS - 1;
  await db.update(fileCleanupQueue).set({ attemptCount: belowMax, lastError: "sim error" }).where(eq(fileCleanupQueue.id, row.id));
  const [mid] = await db.select().from(fileCleanupQueue).where(eq(fileCleanupQueue.id, row.id));
  assert(mid.attemptCount === belowMax, `attemptCount=${belowMax} below max`);
  assert(mid.failedAt === null, "failedAt NULL below max");

  await db.update(fileCleanupQueue).set({ attemptCount: FILE_CLEANUP_MAX_ATTEMPTS, failedAt: new Date(), lastError: "exhausted" }).where(eq(fileCleanupQueue.id, row.id));
  const [ex] = await db.select().from(fileCleanupQueue).where(eq(fileCleanupQueue.id, row.id));
  assert(ex.attemptCount === FILE_CLEANUP_MAX_ATTEMPTS, `attemptCount=${FILE_CLEANUP_MAX_ATTEMPTS} at max`);
  assert(ex.failedAt !== null, "failedAt set at max");
  assert(ex.lastError === "exhausted", "lastError recorded");

  const batchResult = await processFileCleanupBatch(sourceRef);
  assert(batchResult.processed === 0, "exhausted row excluded from batch");

  const reQ = await db.transaction(async (tx) => queueFileCleanupInTx(
    tx as any, companyId,
    [{ fileId: "smoke-attempt", bucket: "test-bucket", storageKey: `tenants/${companyId}/smoke/attempt.jpg`, storageProvider: "r2" }],
    `${SOURCE_PREFIX}:re_queue`));
  assert(reQ.queued === 1, `failed row can be re-queued (got queued=${reQ.queued})`);
}

// ─── Test 5: Unique constraint fires directly ─────────────────────────────────
async function testDedupeConstraint(companyId: string) {
  console.log("\n[5] Deduplication unique constraint enforcement");
  const sourceRef = `${SOURCE_PREFIX}:dedupe`;
  const key = `tenants/${companyId}/smoke/dedupe.jpg`;

  await db.insert(fileCleanupQueue).values({ companyId, fileId: "d1", bucket: "test-bucket", storageKey: key, storageProvider: "r2", sourceRef });

  let threw = false;
  try {
    await db.insert(fileCleanupQueue).values({ companyId, fileId: "d2", bucket: "test-bucket", storageKey: key, storageProvider: "r2", sourceRef: `${sourceRef}:2` });
  } catch (err: unknown) {
    const msg = String((err as Error)?.message ?? "").toLowerCase();
    threw = msg.includes("unique") || msg.includes("duplicate") || msg.includes("constraint");
  }
  assert(threw, "duplicate (company_id, bucket, storage_key) raises unique constraint");
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  // Dynamic imports — only run after DATABASE_URL is set above.
  ({ db } = await import("../db"));
  ({ sql, eq, and } = await import("drizzle-orm"));
  ({ fileCleanupQueue } = await import("@shared/schema"));
  ({ queueFileCleanupInTx, processFileCleanupBatch, FILE_CLEANUP_MAX_ATTEMPTS } = await import("../services/fileCleanupService"));

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  file_cleanup_queue smoke test");
  console.log(`  FILE_CLEANUP_MAX_ATTEMPTS = ${FILE_CLEANUP_MAX_ATTEMPTS}`);
  console.log("═══════════════════════════════════════════════════════════");

  let companyId: string;
  try {
    companyId = await getFirstCompanyId();
    console.log(`  Using companyId: ${companyId}`);
  } catch (err) {
    console.error("FATAL:", err);
    process.exit(1);
  }

  try {
    await testSchema();
    await testQueueInTx(companyId);
    await testProcessBatchNoR2(companyId);
    await testAttemptCountAndFailedAt(companyId);
    await testDedupeConstraint(companyId);
  } finally {
    await cleanupTestRows();
    console.log("\n  (test rows cleaned up)");
  }

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log("═══════════════════════════════════════════════════════════\n");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => { console.error("Unhandled:", err); process.exit(1); });
