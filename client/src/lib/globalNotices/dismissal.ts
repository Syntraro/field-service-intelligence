/**
 * Notice dismissal persistence.
 *
 * Keyed by `gn:${noticeId}:${version}:${companyId}:${userId}` so:
 *   - dismissals are scoped to the (notice, instance, tenant, user) tuple
 *   - a new instance (e.g. a renewed trial → new `version`) auto-resurrects
 *     the notice
 *   - cross-user / cross-tenant boundaries don't bleed dismissals
 *
 * Storage: localStorage. Cross-device dismissal is intentionally deferred —
 * adding a server endpoint would require a new schema and is out of scope
 * for this pass.
 */

import { useCallback, useSyncExternalStore } from "react";
import type { Notice } from "./types";

const KEY_PREFIX = "gn:";

function buildKey(notice: Notice, companyId: string, userId: string): string {
  return `${KEY_PREFIX}${notice.id}:${notice.version ?? ""}:${companyId}:${userId}`;
}

function readDismissedAt(key: string): number | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    // Private-browsing or quota issues: treat as not-dismissed.
    return null;
  }
}

function writeDismissedAt(key: string, ts: number): void {
  try {
    window.localStorage.setItem(key, String(ts));
    // Hand-rolled storage event so same-tab subscribers re-render.
    window.dispatchEvent(new StorageEvent("storage", { key }));
  } catch {
    // Swallow — UX still degrades gracefully (notice stays visible).
  }
}

/** Subscribe to localStorage changes (cross-tab + same-tab). */
function subscribe(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

/**
 * `true` when the (notice, version, company, user) tuple is currently
 * suppressed. Honors `cooldownHours` — after the cooldown elapses,
 * returns `false` and the orchestrator surfaces the notice again.
 */
export function useIsDismissed(
  notice: Notice | null,
  companyId: string | null,
  userId: string | null,
): boolean {
  const key =
    notice && companyId && userId ? buildKey(notice, companyId, userId) : null;

  const dismissedAt = useSyncExternalStore(
    subscribe,
    () => (key ? readDismissedAt(key) : null),
    () => null, // SSR fallback; project is CSR but kept for safety.
  );

  if (!notice || !key || dismissedAt == null) return false;

  // No cooldown configured → permanent dismissal (until version flips).
  if (!notice.cooldownHours || notice.cooldownHours <= 0) return true;

  const elapsedHours = (Date.now() - dismissedAt) / (1000 * 60 * 60);
  return elapsedHours < notice.cooldownHours;
}

/**
 * Returns a stable callback that records a dismissal for the given
 * notice / tenant / user tuple.
 */
export function useDismissNotice(
  companyId: string | null,
  userId: string | null,
): (notice: Notice) => void {
  return useCallback(
    (notice: Notice) => {
      if (!companyId || !userId) return;
      writeDismissedAt(buildKey(notice, companyId, userId), Date.now());
    },
    [companyId, userId],
  );
}
