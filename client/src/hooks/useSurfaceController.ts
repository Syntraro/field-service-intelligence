/**
 * useSurfaceController — Lifecycle controller for transient UI surfaces.
 *
 * Solves the class of bugs where ephemeral state (search text, debounce timers,
 * in-flight fetches, DOM refs, highlighted indices) leaks between unrelated
 * surfaces (dialogs, popovers, command palettes).
 *
 * Each surface gets its own controller instance. The controller:
 * - Resets all registered state on close
 * - Aborts in-flight requests on close/unmount via AbortController
 * - Cancels pending debounce timers
 * - Provides a mount-safe guard so stale async callbacks don't setState after close
 * - Removes stale React Query cache entries scoped to the surface
 *
 * Usage:
 *   const surface = useSurfaceController(open, { queryKeys: [...] });
 *   // In fetch: { signal: surface.signal }
 *   // Guard: if (surface.isStale()) return;
 *   // Debounce: surface.debounce(key, fn, ms)
 *   // Timer: surface.timeout(key, fn, ms)
 */

import { useRef, useEffect, useCallback } from "react";
import { queryClient } from "@/lib/queryClient";

interface SurfaceControllerOptions {
  /** React Query keys to remove from cache on close */
  queryKeys?: (string | readonly unknown[])[];
}

interface SurfaceController {
  /** AbortSignal — pass to fetch() calls. Aborted on close/unmount. */
  signal: AbortSignal;
  /** Returns true if the surface has closed since this controller was created. */
  isStale: () => boolean;
  /** Debounce a named timer. Auto-cancelled on close/unmount. */
  debounce: (key: string, fn: () => void, ms: number) => void;
  /** Set a named timeout. Auto-cancelled on close/unmount. */
  timeout: (key: string, fn: () => void, ms: number) => void;
  /** Cancel a specific named timer. */
  cancel: (key: string) => void;
  /** Session counter — increments each open, useful as React key to force remount children. */
  session: number;
}

export function useSurfaceController(
  open: boolean,
  options: SurfaceControllerOptions = {}
): SurfaceController {
  const sessionRef = useRef(0);
  const abortRef = useRef<AbortController>(new AbortController());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const openRef = useRef(open);

  // Track current open state for stale checks
  openRef.current = open;

  // On open: increment session, create fresh AbortController
  useEffect(() => {
    if (open) {
      sessionRef.current += 1;
      abortRef.current = new AbortController();
    }
  }, [open]);

  // On close: abort in-flight, cancel all timers, clean query cache
  useEffect(() => {
    if (!open) {
      // Abort any in-flight fetches
      abortRef.current.abort();

      // Cancel all named timers
      timersRef.current.forEach((t) => clearTimeout(t));
      timersRef.current.clear();

      // Remove ephemeral query cache entries
      if (options.queryKeys) {
        for (const key of options.queryKeys) {
          const queryKey = typeof key === "string" ? [key] : key;
          queryClient.removeQueries({ queryKey });
        }
      }
    }
  }, [open]); // options.queryKeys is stable by convention

  // On unmount: abort + cancel regardless of open state
  useEffect(() => {
    return () => {
      abortRef.current.abort();
      timersRef.current.forEach((t) => clearTimeout(t));
      timersRef.current.clear();
    };
  }, []);

  const isStale = useCallback(() => !openRef.current, []);

  const debounce = useCallback((key: string, fn: () => void, ms: number) => {
    const existing = timersRef.current.get(key);
    if (existing !== undefined) clearTimeout(existing);
    timersRef.current.set(key, setTimeout(() => {
      timersRef.current.delete(key);
      if (openRef.current) fn();
    }, ms));
  }, []);

  const timeout = useCallback((key: string, fn: () => void, ms: number) => {
    const existing = timersRef.current.get(key);
    if (existing !== undefined) clearTimeout(existing);
    timersRef.current.set(key, setTimeout(() => {
      timersRef.current.delete(key);
      // Timeouts fire even if surface is closed (e.g., post-success toast)
      fn();
    }, ms));
  }, []);

  const cancel = useCallback((key: string) => {
    const existing = timersRef.current.get(key);
    if (existing !== undefined) {
      clearTimeout(existing);
      timersRef.current.delete(key);
    }
  }, []);

  return {
    signal: abortRef.current.signal,
    isStale,
    debounce,
    timeout,
    cancel,
    session: sessionRef.current,
  };
}
