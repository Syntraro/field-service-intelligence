/**
 * useOfflineNoteQueue — reactive view of the offline queue (2026-04-14).
 *
 * Two exports:
 *   - `useOfflineNotes(visitId)` for the visit detail page (pending + failed
 *     notes for that visit only)
 *   - `useOfflineQueueSummary()` for the global status bar (totals across
 *     the tenant's queue)
 *
 * Both subscribe to the queue's internal pub/sub channel so any enqueue /
 * status update reflows both consumers.
 */

import { useEffect, useState } from "react";
import { listAll, listByVisit, subscribe, type QueuedItem } from "@/lib/offlineQueue";

export function useOfflineNotes(visitId: string): QueuedItem[] {
  const [items, setItems] = useState<QueuedItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const rows = await listByVisit(visitId);
        if (!cancelled) setItems(rows);
      } catch {
        if (!cancelled) setItems([]);
      }
    };
    refresh();
    const unsub = subscribe(() => {
      void refresh();
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [visitId]);

  return items;
}

export interface OfflineQueueSummary {
  pending: number;
  syncing: number;
  failed: number;
  total: number;
}

export function useOfflineQueueSummary(): OfflineQueueSummary {
  const [summary, setSummary] = useState<OfflineQueueSummary>({
    pending: 0,
    syncing: 0,
    failed: 0,
    total: 0,
  });

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const rows = await listAll();
        if (cancelled) return;
        let pending = 0;
        let syncing = 0;
        let failed = 0;
        for (const r of rows) {
          if (r.syncStatus === "pending") pending++;
          else if (r.syncStatus === "syncing") syncing++;
          else if (r.syncStatus === "failed") failed++;
        }
        setSummary({ pending, syncing, failed, total: rows.length });
      } catch {
        if (!cancelled) setSummary({ pending: 0, syncing: 0, failed: 0, total: 0 });
      }
    };
    refresh();
    const unsub = subscribe(() => {
      void refresh();
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  return summary;
}
