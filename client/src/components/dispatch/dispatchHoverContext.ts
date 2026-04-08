/**
 * Dispatch hover store — external store for map↔calendar hover linkage.
 *
 * 2026-04-08: Refactored from React Context to a tiny external store with
 * per-id selector hooks. The previous Context-based implementation caused
 * ALL DispatchVisitBlock instances to re-render on every hover because they
 * were Context consumers. The new model uses useSyncExternalStore so only
 * the previously-hovered and newly-hovered blocks re-render on each change.
 *
 * Public API:
 *   - useHoverSetter()       → returns stable setHoveredVisitId callback
 *   - useIsVisitHovered(id)  → returns boolean, only re-renders when this id flips
 *   - getHoveredVisitId()    → imperative read (rare cases)
 *
 * Provider lives in DispatchPreview.tsx as a no-op now (kept as a marker
 * boundary for clarity but not functionally required).
 */

import { useSyncExternalStore, useCallback, createContext } from "react";

// ── Module-scoped store ──────────────────────────────────────────────────────
// Single mutable cell. Listeners are notified on every change.
let hoveredVisitId: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  // Snapshot to avoid mutation during iteration if a listener unsubscribes itself.
  Array.from(listeners).forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setHoveredVisitId(id: string | null): void {
  if (hoveredVisitId === id) return;
  hoveredVisitId = id;
  emit();
}

export function getHoveredVisitId(): string | null {
  return hoveredVisitId;
}

// ── Hooks ───────────────────────────────────────────────────────────────────

/**
 * Returns a stable setter — never re-renders the consumer.
 * Use this in components that only WRITE hover state (e.g., onMouseEnter handlers).
 */
export function useHoverSetter(): (id: string | null) => void {
  return useCallback(setHoveredVisitId, []);
}

/**
 * Returns true if the given visit id is currently hovered.
 * Re-renders ONLY when that specific id's hover state flips (subscribe + getSnapshot).
 * Visit blocks for OTHER ids do not re-render when hover changes elsewhere.
 */
export function useIsVisitHovered(visitId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => hoveredVisitId === visitId,
    () => false, // server snapshot
  );
}

/**
 * Backward-compatible hook for components that need both read + write.
 * Re-renders on every hover change. Prefer useHoverSetter + useIsVisitHovered
 * for fine-grained subscription where possible.
 */
export function useDispatchHover(): {
  hoveredVisitId: string | null;
  setHoveredVisitId: (id: string | null) => void;
} {
  const id = useSyncExternalStore(
    subscribe,
    () => hoveredVisitId,
    () => null,
  );
  return { hoveredVisitId: id, setHoveredVisitId };
}

// ── Legacy provider (now a no-op marker) ────────────────────────────────────
// Kept so existing <DispatchHoverContext.Provider> wrapping in DispatchPreview
// continues to type-check. The store is module-scoped, so the provider does
// not actually carry state — it's just a structural marker now.
export const DispatchHoverContext = createContext<{
  hoveredVisitId: string | null;
  setHoveredVisitId: (id: string | null) => void;
}>({
  hoveredVisitId: null,
  setHoveredVisitId: () => {},
});
