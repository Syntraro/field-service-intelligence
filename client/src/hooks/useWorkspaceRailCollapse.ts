import { useCallback, useState } from "react";

/**
 * Persists left-rail collapsed state in localStorage.
 * Private-browsing / quota errors are silently swallowed.
 */
export function useWorkspaceRailCollapse(
  lsKey: string,
  defaultValue = false,
): { collapsed: boolean; toggle: () => void } {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return defaultValue;
    try {
      const stored = localStorage.getItem(lsKey);
      return stored !== null ? stored === "1" : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(lsKey, next ? "1" : "0");
      } catch {
        // private browsing / storage quota
      }
      return next;
    });
  }, [lsKey]);

  return { collapsed, toggle };
}
