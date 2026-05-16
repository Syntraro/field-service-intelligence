import { useState, useCallback } from "react";

const LAYOUT_KEY = "syntraro.layout.mode";

export type LayoutMode = "sidebar" | "topbar";

export function useLayoutPreference() {
  const [mode, setModeState] = useState<LayoutMode>(() => {
    try {
      const stored = localStorage.getItem(LAYOUT_KEY);
      return stored === "topbar" ? "topbar" : "sidebar";
    } catch {
      return "sidebar";
    }
  });

  const setMode = useCallback((m: LayoutMode) => {
    setModeState(m);
    try {
      localStorage.setItem(LAYOUT_KEY, m);
    } catch {
      // localStorage unavailable (private browsing, storage quota, etc.)
    }
  }, []);

  const toggle = useCallback(() => {
    setMode(mode === "sidebar" ? "topbar" : "sidebar");
  }, [mode, setMode]);

  return { mode, setMode, toggle };
}
