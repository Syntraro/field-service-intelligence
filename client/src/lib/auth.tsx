import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, initCSRF, resetCsrf, resetSessionExpiredGuard } from "./queryClient";

export interface User {
  id: string;
  email: string;
  role: string;
  companyId: string;
  isAdmin?: boolean;
  firstName?: string | null;
  lastName?: string | null;
  // 2026-04-19 Hybrid SaaS onboarding gate:
  //  - `onboardingCompletedAt` is null until the owner finishes the wizard
  //  - `isImpersonating` bypasses the gate when a platform admin is using
  //    this session (server flag `req.isImpersonating`)
  onboardingCompletedAt?: string | null;
  isImpersonating?: boolean;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<User>;
  /**
   * Create a new user account.
   * 2026-04-19: accepts the full signup payload (public staged flow or
   * invite flow) so AuthProvider's onSuccess can call setUser
   * synchronously and ProtectedRoute never sees a stale null after
   * navigation. Previous `(email, password)` signature was insufficient
   * for the staged public payload and for invite tokens.
   */
  signup: (body: Record<string, unknown>) => Promise<User>;
  logout: () => Promise<void>;
  /**
   * 2026-04-10 Phase-2 Fix A — canonical "the session is gone, clean up
   * everything locally" entry point. Called by SessionExpiredDialog instead
   * of an ad-hoc queryClient.clear(). Does NOT round-trip to /api/auth/logout
   * (the session is already gone server-side).
   */
  clearAuth: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userInitialized, setUserInitialized] = useState(false);

  // Pre-warm CSRF token on mount so login click doesn't block on the fetch
  useEffect(() => {
    initCSRF().catch(() => {});
  }, []);

  // 2026-05-03 — first-login race protection lives in the wipe-condition
  // below (the `(isError && !data) || data === null` branch), NOT in an
  // `enabled` flag on this query. Reasoning: the race is a probe that's
  // already in-flight when the user clicks Login. `enabled: false` does
  // not abort an in-flight fetch in TanStack v5, and the disabled
  // observer still receives the cache update when that fetch settles —
  // so the stale 401 still reaches the observer's reducer regardless.
  // `cancelQueries` also can't abort the request: `getQueryFn` doesn't
  // pass an `AbortSignal` to `fetch`. The wipe-condition is therefore
  // the only effective defense, and adding `enabled: !loginMutation.isPending`
  // here would either require reordering hooks (loginMutation is declared
  // ~50 lines below) or mirroring `isPending` into a redundant state slot,
  // for zero additional protection. Keep this query unconditional.
  const { data, isLoading, isError } = useQuery<User>({
    queryKey: ["/api/auth/me"],
    retry: false,
  });

  useEffect(() => {
    if (data) {
      setUser(data);
      setUserInitialized(true);
    } else if ((isError && !data) || data === null) {
      // 2026-05-03 first-login race fix: previously this branch was
      // `else if (isError || data === null)`. That wiped `user` whenever
      // the bootstrap `/api/auth/me` query observer reported `isError=true`
      // — including when a stale in-flight probe (started before
      // `/api/csrf-token` minted a session cookie) returned 401 AFTER
      // `loginMutation.onSuccess` had already seeded the cache via
      // `queryClient.setQueryData(["/api/auth/me"], userData)`. TanStack v5
      // preserves `data` on an error transition, so the observer would
      // emit `{ data: userData, isError: true }`; the old wipe nulled
      // the freshly seeded user, ProtectedRoute then read `user=null`,
      // and the user was bounced back to /login on the first click. Now
      // the wipe only fires when `data` itself is falsy — so a stale 401
      // can no longer overwrite a valid login.
      setUser(null);
      setUserInitialized(true);
    } else if (!isLoading && data === undefined) {
      // 2026-04-10 Phase-2 Fix A: post-clearAuth() safety net. After
      // queryClient.removeQueries({queryKey:["/api/auth/me"]}), data is
      // undefined and isError is false — neither branch above matches and
      // the local user state would otherwise stay stale. This branch wipes
      // it the moment isLoading settles, so a stale user can never bounce
      // the Login page back into the protected app.
      setUser(null);
      setUserInitialized(true);
    }
  }, [data, isError, isLoading]);

  /**
   * 2026-04-10 Phase-2 Fix A: canonical local auth-state wipe.
   * Mirrors logoutMutation.onMutate + onSuccess but skips the server round
   * trip (the session is already gone server-side). Wraps the four pieces
   * of "I am no longer authenticated client-side" cleanup so the dialog
   * does not have to know the internals.
   */
  const clearAuth = useCallback(() => {
    setUser(null);
    setUserInitialized(true);
    queryClient.removeQueries({ queryKey: ["/api/auth/me"] });
    queryClient.clear();
    resetCsrf();
  }, []);

  const loginMutation = useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) =>
      apiRequest<User>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    onSuccess: (userData) => {
      // Security/isolation fix: wipe any cached tenant data from a prior
      // session BEFORE seeding the new identity. Without this, a user who
      // signs in after a different tenant user in the same tab inherits
      // stale data (/api/company-settings, tasks, etc.) until refetch.
      queryClient.cancelQueries();
      // 2026-04-22 first-click login fix: removeQueries(predicate) instead
      // of clear(). The previous `clear()` wiped /api/auth/me while the
      // AuthProvider's useQuery observer was still mounted, which caused
      // TanStack to refetch it immediately — and that refetch could race
      // with `setQueryData(["/api/auth/me"], userData)` below. On cold
      // sessions the refetch sometimes landed before the Set-Cookie
      // response was visible to the new request, returned 401, and
      // overwrote the freshly seeded user state with an error snapshot.
      // AuthProvider's useEffect then wrote `user = null`, ProtectedRoute
      // bounced to /login, and the user had to click Login a second time.
      // The predicate preserves the tenant-data wipe exactly as before;
      // it only excludes the auth query we're about to seed by hand on
      // the next two lines so `setQueryData` is the sole writer.
      queryClient.removeQueries({
        predicate: (query) => query.queryKey?.[0] !== "/api/auth/me",
      });
      setUser(userData);
      setUserInitialized(true);
      queryClient.setQueryData(["/api/auth/me"], userData);
      // 2026-04-10 Phase-2 Fix A/B: a real successful login re-arms the
      // session-expired one-shot guard so the next genuine expiration can
      // open the modal again.
      resetSessionExpiredGuard();
      // Pre-warm CSRF token for the new session (non-blocking).
      // The old token may be invalid after passport session regeneration,
      // but apiRequest auto-retries on EBADCSRFTOKEN, so this is safe.
      initCSRF().catch(() => {});
    },
  });

  const signupMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      apiRequest<User>("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (userData) => {
      // Same rationale as loginMutation onSuccess — isolation between
      // sessions. Same 2026-04-22 first-click fix applied: predicate-
      // scoped removeQueries instead of clear() so the mounted
      // /api/auth/me observer does not race a refetch against the
      // setQueryData seed below.
      queryClient.cancelQueries();
      queryClient.removeQueries({
        predicate: (query) => query.queryKey?.[0] !== "/api/auth/me",
      });
      setUser(userData);
      setUserInitialized(true);
      queryClient.setQueryData(["/api/auth/me"], userData);
      // 2026-04-10 Phase-2: signup is a successful auth — re-arm the guard.
      resetSessionExpiredGuard();
      initCSRF().catch(() => {});
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () =>
      apiRequest("/api/auth/logout", { method: "POST" }),
    onMutate: () => {
      setUser(null);
      queryClient.cancelQueries();
    },
    onSuccess: () => {
      queryClient.clear();
      // 2026-04-14: drop the tech offline queue so the next user on this
      // device doesn't inherit the previous session's pending notes.
      // Fire-and-forget — an IDB error must not turn a successful server
      // logout into a rejection. Only runs on confirmed 2xx logout.
      void import("./offlineQueue")
        .then((m) => m.clearAll())
        .catch(() => {});
      // Pre-warm CSRF for the next login (non-blocking)
      initCSRF().catch(() => {});
    },
  });

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading: isLoading || !userInitialized,
        login: (e, p) => loginMutation.mutateAsync({ email: e, password: p }),
        signup: (body) => signupMutation.mutateAsync(body),
        logout: () => logoutMutation.mutateAsync(),
        clearAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
