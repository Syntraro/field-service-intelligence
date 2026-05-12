import { useCallback, useEffect } from "react";
import { useAuth, type User } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";

export type AppearanceTheme = "dark" | "light";

/**
 * Apply a theme to the document root and write the localStorage hint used by
 * the zero-flicker inline script in index.html. DOM-only — does not persist
 * to the DB. Call setTheme() from useTheme() for durable persistence.
 */
export function applyTheme(theme: AppearanceTheme): void {
  if (theme === "light") {
    document.documentElement.classList.add("light");
  } else {
    document.documentElement.classList.remove("light");
  }
  localStorage.setItem("appearance", theme);
}

/**
 * useTheme — appearance preference hook.
 *
 * Reads the current user's appearance preference from the auth cache,
 * syncs the DOM class whenever it changes, and exposes setTheme() for
 * durable DB persistence via PATCH /api/auth/me/appearance with
 * optimistic-update + rollback on error.
 */
export function useTheme() {
  const { user } = useAuth();
  const theme: AppearanceTheme = user?.appearance ?? "dark";

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback(async (next: AppearanceTheme) => {
    // Optimistic DOM + localStorage update
    applyTheme(next);
    // Optimistic cache update so the toggle re-renders immediately
    if (user) {
      queryClient.setQueryData<User>(["/api/auth/me"], { ...user, appearance: next });
    }
    try {
      await apiRequest("/api/auth/me/appearance", {
        method: "PATCH",
        body: JSON.stringify({ appearance: next }),
      });
    } catch {
      // Roll back DOM, localStorage, and cache on failure
      applyTheme(theme);
      if (user) {
        queryClient.setQueryData<User>(["/api/auth/me"], user);
      }
    }
  }, [user, theme]);

  return { theme, setTheme };
}
