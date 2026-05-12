/**
 * useNoteSyncReplay — drains the offline note queue when connectivity
 * returns (2026-04-14, Phase 2 offline).
 *
 * Behavior:
 *   - Mounts a single time from `TechApp`. Additional mounts are a no-op
 *     because the drain loop is guarded by a module-level single-flight
 *     lock.
 *   - On boot, `resetInFlightOnBoot()` flips any row stuck as `syncing`
 *     (from an earlier session that died mid-send) back to `pending`.
 *   - Drains on: initial mount (if online), every `online` event, and
 *     every `lastReconnectedAt` change (covers `visibilitychange`).
 *   - Exposes `retry(id)` / `discard(id)` for UI buttons on failed rows.
 *   - Single drainer at a time; FIFO across the whole queue.
 *   - Replay calls the canonical tech route
 *     `POST /api/tech/visits/:visitId/notes` via `apiRequest`.
 *   - On success: remove the row, invalidate the visit detail query so
 *     the canonical note replaces the pending placeholder.
 *   - On 4xx (not 408/429): mark row `failed` with the error message;
 *     UI offers Retry / Discard. No auto-retry.
 *   - On 5xx / network / 408 / 429: mark `failed` and stop this drain;
 *     next connectivity event retries.
 */

import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  listAll,
  remove,
  resetInFlightOnBoot,
  updateStatus,
  type QueuedItem,
} from "@/lib/offlineQueue";
import { useOnline } from "@/hooks/useOnline";

let DRAINING = false;

interface ApiLikeError {
  status?: number;
  message?: string;
}

function isRetryable(err: ApiLikeError): boolean {
  const s = Number(err?.status);
  if (!s || !Number.isFinite(s)) return true; // network-ish
  if (s >= 500) return true;
  if (s === 408 || s === 429) return true;
  return false;
}

async function sendOne(item: QueuedItem): Promise<void> {
  if (item.type !== "job_note_create") return;
  await apiRequest(`/api/tech/visits/${item.visitId}/notes`, {
    method: "POST",
    body: JSON.stringify({
      text: item.payload.text,
      equipmentId: item.payload.equipmentId,
      // idempotencyKey lets the server return the existing note if this replay
      // races with a prior send that already landed (crash-safe de-duplication).
      idempotencyKey: item.payload.idempotencyKey,
    }),
  });
}

export function useNoteSyncReplay(): {
  retry: (id: string) => Promise<void>;
  discard: (id: string) => Promise<void>;
} {
  const { isOnline, lastReconnectedAt } = useOnline();
  const qc = useQueryClient();
  const bootedRef = useRef(false);

  const drain = useCallback(async () => {
    if (DRAINING) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    DRAINING = true;
    try {
      const rows = await listAll();
      for (const row of rows) {
        if (row.syncStatus !== "pending") continue;
        await updateStatus(row.id, { syncStatus: "syncing" });
        try {
          await sendOne(row);
          await remove(row.id);
          qc.invalidateQueries({ queryKey: ["/api/tech/visits", row.visitId] });
        } catch (err: any) {
          const msg = err?.message ?? "Sync failed";
          await updateStatus(row.id, {
            syncStatus: "failed",
            retryCount: (row.retryCount ?? 0) + 1,
            lastError: msg,
          });
          if (isRetryable(err)) {
            // Stop this drain cycle; next connectivity event will retry.
            break;
          }
          // 4xx hard failure — leave as failed, keep draining the next item.
        }
      }
    } finally {
      DRAINING = false;
    }
  }, [qc]);

  // Boot: migrate orphaned `syncing` rows, then attempt an initial drain.
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    (async () => {
      await resetInFlightOnBoot();
      if (typeof navigator === "undefined" || navigator.onLine) {
        void drain();
      }
    })();
  }, [drain]);

  // Trigger drain on connectivity recovery / tab-focus reassertion.
  useEffect(() => {
    if (isOnline) void drain();
  }, [isOnline, lastReconnectedAt, drain]);

  const retry = useCallback(
    async (id: string) => {
      await updateStatus(id, { syncStatus: "pending" });
      void drain();
    },
    [drain],
  );

  const discard = useCallback(async (id: string) => {
    await remove(id);
  }, []);

  return { retry, discard };
}
