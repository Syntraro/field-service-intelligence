// 2026-04-20 Phase 4: shared dirty-state hook.
// Single source of truth for "has this form been edited since the last save?"
// across every editable surface in the Team hub (and anywhere else that wants
// it). Replaces per-component confirmIfDirty helpers that diverged over time.
//
// Usage:
//   const dirty = useUnsavedChanges();
//   dirty.markDirty();
//   dirty.markClean();
//   dirty.confirmLeave(() => setSelectedId(next));
//
// The hook also binds a `beforeunload` handler while dirty, so full-page
// navigations (refresh, close tab) get the browser's native "leave site?"
// prompt. Removed on unmount or when markClean() fires.
import { useCallback, useEffect, useRef, useState } from "react";

export interface UnsavedChanges {
  /** True when markDirty() has been called and markClean() has not followed. */
  isDirty: boolean;
  /** Call when local edits diverge from server state. Safe to call repeatedly. */
  markDirty: () => void;
  /** Call after a successful save or an intentional reset. */
  markClean: () => void;
  /**
   * Gate any action that would discard local edits.
   * If clean → runs `action` immediately.
   * If dirty → prompts the user; runs `action` only on confirm.
   *
   * `message` is optional; defaults to a sensible phrasing.
   */
  confirmLeave: (action: () => void, message?: string) => void;
}

const DEFAULT_MESSAGE = "You have unsaved changes. Discard them?";

export function useUnsavedChanges(): UnsavedChanges {
  const [isDirty, setIsDirty] = useState(false);
  // Mirror the state into a ref so the beforeunload handler doesn't need to
  // re-bind every render just to see the latest flag.
  const dirtyRef = useRef(false);

  const markDirty = useCallback(() => {
    if (!dirtyRef.current) {
      dirtyRef.current = true;
      setIsDirty(true);
    }
  }, []);

  const markClean = useCallback(() => {
    if (dirtyRef.current) {
      dirtyRef.current = false;
      setIsDirty(false);
    }
  }, []);

  const confirmLeave = useCallback(
    (action: () => void, message: string = DEFAULT_MESSAGE) => {
      if (!dirtyRef.current) {
        action();
        return;
      }
      // Native confirm matches the rest of the app's destructive prompts
      // (e.g. Phase 3 SchedulesTab). Good enough for an internal tool; avoids
      // building a custom modal just for this.
      if (window.confirm(message)) {
        action();
      }
    },
    [],
  );

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      // Required for Chrome/Edge — setting returnValue triggers the native prompt.
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  return { isDirty, markDirty, markClean, confirmLeave };
}
