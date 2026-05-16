import { db } from "../db";
import { eq, and, isNull, inArray, lt, sql } from "drizzle-orm";
import { fileCleanupQueue, files, type FileCleanupQueueEntry } from "@shared/schema";
import { getR2Provider, isR2Configured } from "./storage/R2StorageProvider";

export const FILE_CLEANUP_MAX_ATTEMPTS = 5;
const FILE_CLEANUP_BATCH_SIZE = 100;
const FILE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

export interface FileCleanupEntry {
  fileId: string;
  bucket: string;
  storageKey: string;
  storageProvider: string;
}

export interface CleanupBatchResult {
  processed: number;
  skipped: number;
  errors: number;
}

/**
 * Insert cleanup queue rows inside an existing transaction.
 * Deduplication via ON CONFLICT DO NOTHING on the partial unique index.
 */
export async function queueFileCleanupInTx(
  tx: typeof db,
  companyId: string,
  entries: FileCleanupEntry[],
  sourceRef: string,
): Promise<{ queued: number; skipped: number }> {
  if (entries.length === 0) return { queued: 0, skipped: 0 };

  const rows = entries.map((e) => ({
    companyId,
    fileId: e.fileId,
    bucket: e.bucket,
    storageKey: e.storageKey,
    storageProvider: e.storageProvider,
    sourceRef,
  }));

  const result = await (tx as any)
    .insert(fileCleanupQueue)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: fileCleanupQueue.id });

  const queued = result.length;
  return { queued, skipped: rows.length - queued };
}

/**
 * Process a batch of pending queue rows.
 * Groups R2 objects by bucket for efficient batch deletion.
 * Only marks processedAt after successful object deletion.
 * Marks failedAt after FILE_CLEANUP_MAX_ATTEMPTS exhausted.
 */
export async function processFileCleanupBatch(sourceRef?: string): Promise<CleanupBatchResult> {
  const baseWhere = and(
    isNull(fileCleanupQueue.processedAt),
    isNull(fileCleanupQueue.failedAt),
    lt(fileCleanupQueue.attemptCount, FILE_CLEANUP_MAX_ATTEMPTS),
  );

  const rows = await db
    .select()
    .from(fileCleanupQueue)
    .where(baseWhere)
    .orderBy(fileCleanupQueue.createdAt)
    .limit(FILE_CLEANUP_BATCH_SIZE);

  if (rows.length === 0) return { processed: 0, skipped: 0, errors: 0 };

  const filtered = sourceRef ? rows.filter((r) => r.sourceRef === sourceRef) : rows;
  if (filtered.length === 0) return { processed: 0, skipped: 0, errors: 0 };

  let processed = 0;
  let errors = 0;

  if (!isR2Configured()) {
    // Mark all as processed in non-R2 environments (local dev without R2).
    const ids = filtered.map((r) => r.id);
    await db
      .update(fileCleanupQueue)
      .set({ processedAt: new Date(), attemptCount: sql`attempt_count + 1` })
      .where(inArray(fileCleanupQueue.id, ids));
    console.log(`[fileCleanup] R2 not configured — marked ${ids.length} queue rows as processed (no-op)`);
    return { processed: ids.length, skipped: 0, errors: 0 };
  }

  // Group by bucket for batch deletion.
  const byBucket = new Map<string, FileCleanupQueueEntry[]>();
  for (const row of filtered) {
    if (row.storageProvider !== "r2") continue;
    const bucket = row.bucket;
    if (!byBucket.has(bucket)) byBucket.set(bucket, []);
    byBucket.get(bucket)!.push(row);
  }

  const r2 = getR2Provider();

  for (const [bucket, bucketRows] of Array.from(byBucket.entries())) {
    // R2 batch API max 1000 keys — chunk defensively.
    for (let i = 0; i < bucketRows.length; i += 1000) {
      const chunk = bucketRows.slice(i, i + 1000);
      const keys = chunk.map((r) => r.storageKey);

      let batchResult: { deleted: number; errors: Array<{ key: string; message: string }> };
      try {
        batchResult = await r2.deleteObjectsBatch(bucket, keys);
      } catch (err: any) {
        // Entire batch call failed — increment attempt_count on all rows.
        console.error(`[fileCleanup] deleteObjectsBatch failed for bucket=${bucket}:`, err?.message ?? err);
        const ids = chunk.map((r) => r.id);
        await db
          .update(fileCleanupQueue)
          .set({
            attemptCount: sql`attempt_count + 1`,
            lastError: err?.message ?? "batch call failed",
            ...(chunk.some((r) => r.attemptCount + 1 >= FILE_CLEANUP_MAX_ATTEMPTS)
              ? { failedAt: new Date() }
              : {}),
          })
          .where(inArray(fileCleanupQueue.id, ids));
        errors += chunk.length;
        continue;
      }

      // Build error key set for per-row handling.
      const errorKeys = new Set(batchResult.errors.map((e) => e.key));
      const errorByKey = new Map(batchResult.errors.map((e) => [e.key, e.message]));

      for (const row of chunk) {
        const hadError = errorKeys.has(row.storageKey);
        const newAttemptCount = row.attemptCount + 1;
        if (hadError) {
          const exhausted = newAttemptCount >= FILE_CLEANUP_MAX_ATTEMPTS;
          await db
            .update(fileCleanupQueue)
            .set({
              attemptCount: newAttemptCount,
              lastError: errorByKey.get(row.storageKey) ?? "r2 error",
              ...(exhausted ? { failedAt: new Date() } : {}),
            })
            .where(eq(fileCleanupQueue.id, row.id));
          errors++;
          console.warn(
            `[fileCleanup] R2 delete error key=${row.storageKey} attempt=${newAttemptCount}/${FILE_CLEANUP_MAX_ATTEMPTS}`,
          );
        } else {
          // Object deleted — mark processed and soft-delete the files row.
          await db
            .update(fileCleanupQueue)
            .set({ processedAt: new Date(), attemptCount: newAttemptCount })
            .where(eq(fileCleanupQueue.id, row.id));

          // Best-effort soft-delete of the files metadata row.
          try {
            await db
              .update(files)
              .set({ status: "deleted", updatedAt: new Date() })
              .where(and(eq(files.id, row.fileId), eq(files.companyId, row.companyId)));
          } catch {
            // Files row may already be gone — not fatal.
          }

          processed++;
        }
      }
    }
  }

  const skipped = filtered.length - processed - errors;
  console.log(`[fileCleanup] batch done — processed=${processed} errors=${errors} skipped=${skipped}`);
  return { processed, skipped, errors };
}

/**
 * Best-effort post-commit bridge.
 * Fires processFileCleanupBatch in the background after a delete transaction
 * commits. Errors are logged and swallowed — the background worker handles retry.
 */
export function triggerCleanupAsync(sourceRef: string, _companyId: string): void {
  setImmediate(() => {
    processFileCleanupBatch(sourceRef).catch((err) => {
      console.error(`[fileCleanup] triggerCleanupAsync failed (sourceRef=${sourceRef}):`, err?.message ?? err);
    });
  });
}

/**
 * Background interval worker.
 * Sweeps all pending queue rows on a 5-minute interval.
 * Returns the interval handle for graceful shutdown.
 */
export function startFileCleanupWorker(): NodeJS.Timeout {
  return setInterval(() => {
    processFileCleanupBatch().catch((err) => {
      console.error("[fileCleanup] background sweep failed:", err?.message ?? err);
    });
  }, FILE_CLEANUP_INTERVAL_MS).unref();
}
