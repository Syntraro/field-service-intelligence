/**
 * PlatformAuth — client-side context + route guard for the /platform admin
 * console.
 *
 * 2026-04-22 Phase 1 Platform Auth Separation: backed by the psid-cookie
 * session the server establishes at `POST /api/platform/auth/login`.
 * `GET /api/platform/auth/me` hydrates the current identity; 401 means
 * not signed in.
 *
 * Intentionally minimal. Lives alongside the tenant `AuthProvider` in
 * `lib/auth` — the two are independent concerns. Platform routes never
 * consult tenant auth state.
 */
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { Redirect } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { PlatformCapability } from "@shared/platformCapabilities";

export interface PlatformUser {
  id: string;
  email: string;
  role: string;
  fullName: string | null;
  // 2026-04-22 Revised Phase 1: canonical role set + capability set.
  roles: readonly string[];
  capabilities: readonly PlatformCapability[];
}

interface PlatformAuthContextValue {
  user: PlatformUser | null;
  isLoading: boolean;
  refresh: () => void;
  logout: () => Promise<void>;
  /** Returns true if the authenticated user holds `cap`; false otherwise. */
  hasCapability: (cap: PlatformCapability) => boolean;
}

const PlatformAuthContext = createContext<PlatformAuthContextValue | undefined>(
  undefined,
);

export function PlatformAuthProvider({ children }: { children: ReactNode }) {
  const query = useQuery<{ user: PlatformUser }>({
    queryKey: ["/api/platform/auth/me"],
    queryFn: () => apiRequest(`/api/platform/auth/me`),
    retry: false,
    staleTime: 60_000,
  });

  const user = query.data?.user ?? null;
  const isLoading = query.isLoading;

  const refresh = () => {
    query.refetch();
  };

  const logout = async () => {
    try {
      await apiRequest(`/api/platform/auth/logout`, { method: "POST" });
    } finally {
      query.refetch();
    }
  };

  const hasCapability = (cap: PlatformCapability): boolean => {
    return user?.capabilities?.includes(cap) ?? false;
  };

  return (
    <PlatformAuthContext.Provider
      value={{ user, isLoading, refresh, logout, hasCapability }}
    >
      {children}
    </PlatformAuthContext.Provider>
  );
}

export function usePlatformAuth(): PlatformAuthContextValue {
  const ctx = useContext(PlatformAuthContext);
  if (!ctx) {
    throw new Error("usePlatformAuth must be used within PlatformAuthProvider");
  }
  return ctx;
}

/**
 * Route guard for /platform/* pages. Redirects to /platform/login when no
 * active platform session is present. Does NOT consult tenant auth — a
 * signed-in tenant user is still "not authenticated" on platform routes.
 */
export function RequirePlatformAuth({ children }: { children: ReactNode }) {
  const { user, isLoading } = usePlatformAuth();

  // Tiny hydration hold — avoids a flicker redirect on first mount while
  // GET /api/platform/auth/me resolves.
  useEffect(() => {
    // no-op — present to make future telemetry hooks easy
  }, [user, isLoading]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!user) {
    return <Redirect to="/platform/login" />;
  }

  return <>{children}</>;
}

/**
 * Self-contained wrapper for /platform/* routes in App.tsx. Composes the
 * provider + the guard so callsites look like:
 *
 *   <Route path="/platform/tenants">
 *     <PlatformAuthRoute cap="tenant:read">
 *       <PlatformTenantsList />
 *     </PlatformAuthRoute>
 *   </Route>
 *
 * When `cap` is provided, the authenticated user must also hold that
 * capability; otherwise `<AccessDenied />` renders inside the platform
 * shell. This keeps the UX inside one console — no redirects, no
 * separate error page.
 */
export function PlatformAuthRoute({
  children,
  cap,
}: {
  children: ReactNode;
  cap?: PlatformCapability;
}) {
  return (
    <PlatformAuthProvider>
      <RequirePlatformAuth>
        {cap ? <RequireCapability cap={cap}>{children}</RequireCapability> : children}
      </RequirePlatformAuth>
    </PlatformAuthProvider>
  );
}

/**
 * Gate that renders children only if the current platform user holds
 * `cap`. Otherwise renders a small "no access" panel. Can be used inside
 * pages to conditionally render write-capable sections too.
 */
export function RequireCapability({
  cap,
  children,
  fallback,
}: {
  cap: PlatformCapability;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { hasCapability, isLoading } = usePlatformAuth();
  if (isLoading) return null;
  if (!hasCapability(cap)) {
    return fallback === undefined ? <AccessDenied cap={cap} /> : <>{fallback}</>;
  }
  return <>{children}</>;
}

function AccessDenied({ cap }: { cap: PlatformCapability }) {
  return (
    <div
      className="mx-auto max-w-md my-12 rounded-lg border bg-muted/30 p-6 text-center"
      data-testid="platform-access-denied"
      data-capability={cap}
    >
      <div className="text-sm font-semibold mb-1">No access to this section</div>
      <p className="text-xs text-muted-foreground">
        Your internal role doesn't include the{" "}
        <code className="font-mono text-[11px]">{cap}</code> capability.
        Contact a platform admin if you need access.
      </p>
    </div>
  );
}
