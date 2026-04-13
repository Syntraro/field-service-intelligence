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
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<User>;
  signup: (email: string, password: string) => Promise<User>;
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

  const { data, isLoading, isError } = useQuery<User>({
    queryKey: ["/api/auth/me"],
    retry: false,
  });

  useEffect(() => {
    if (data) {
      setUser(data);
      setUserInitialized(true);
    } else if (isError || data === null) {
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
    mutationFn: async ({ email, password }: { email: string; password: string }) =>
      apiRequest<User>("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    onSuccess: (userData) => {
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
        signup: (e, p) => signupMutation.mutateAsync({ email: e, password: p }),
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
