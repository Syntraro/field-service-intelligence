import { useCallback, useEffect, useRef } from "react";
import { SELECTION_DEBOUNCE_MS } from "@/components/workspace/workspace.constants";

/**
 * Debounced selection handler for workspace right-rail expansion.
 *
 * - Immediate clear when isEmpty=true (rail collapses without lag).
 * - 120ms debounce on non-empty selection — only the row the user
 *   settles on triggers the callback, preventing a query per rapid click.
 * - Cleans up pending timeout on unmount.
 */
export function useWorkspaceSelection<T>(
  onSelect: (ctx: T | null) => void,
  debounceMs: number = SELECTION_DEBOUNCE_MS,
): { handleSelectionChange: (ctx: T, isEmpty: boolean) => void } {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stable ref so the callback never appears in dep arrays.
  const onSelectRef = useRef(onSelect);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);

  const handleSelectionChange = useCallback(
    (ctx: T, isEmpty: boolean) => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);

      if (isEmpty) {
        onSelectRef.current(null);
      } else {
        debounceRef.current = setTimeout(() => {
          onSelectRef.current(ctx);
        }, debounceMs);
      }
    },
    [debounceMs],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, []);

  return { handleSelectionChange };
}
