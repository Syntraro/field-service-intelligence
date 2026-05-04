import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";

// ─── AUDIT INSTRUMENTATION (TEMPORARY) ──────────────────────────────────────
const __rT0 = (): number => {
  if (typeof window === "undefined") return Date.now();
  if (typeof (window as any).__authAuditT0 !== "number") (window as any).__authAuditT0 = performance.now();
  return (window as any).__authAuditT0;
};
const __rTs = (): string => (typeof performance === "undefined" ? String(Date.now()) : (performance.now() - __rT0()).toFixed(1) + "ms");
function routeTrace(tag: string, payload: Record<string, unknown> = {}) {
  // eslint-disable-next-line no-console
  console.log(`[ROUTE-TRACE] ${__rTs()} ${tag}`, payload);
}
let __rMountSeq = 0;

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
  /** 2026-05-03 launch-readiness fix: allows owner / admin / manager /
   *  dispatcher (mirrors the server's `MANAGER_ROLES`). Used by the
   *  Reports surface so manager-level roles whose API access is already
   *  permitted server-side can also reach the corresponding UI. Looser
   *  than `requireAdmin`; both flags accept platform roles for support
   *  impersonation. Technicians are hard-redirected to `/tech/today`
   *  before this check ever runs. */
  requireManager?: boolean;
  requirePlatformAdmin?: boolean;
  /** Phase 6: allows any platform role (admin, support, billing, readonly_audit). */
  requirePlatformRole?: boolean;
}

const PLATFORM_ROLES = [
  "platform_admin",
  "platform_support",
  "platform_billing",
  "platform_readonly_audit",
];

const MANAGER_ROLES = ["owner", "admin", "manager", "dispatcher"];

export default function ProtectedRoute({ children, requireAdmin = false, requireManager = false, requirePlatformAdmin = false, requirePlatformRole = false }: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();
  const [currentPath, setLocation] = useLocation();
  const mountIdRef = useRef<number | null>(null);
  if (mountIdRef.current === null) {
    __rMountSeq += 1;
    mountIdRef.current = __rMountSeq;
    routeTrace("ProtectedRoute MOUNT", {
      mountId: mountIdRef.current,
      currentPath,
      user: user ? { id: user.id, role: user.role } : user,
      isLoading,
    });
  }
  const mountId = mountIdRef.current;
  routeTrace("ProtectedRoute RENDER", {
    mountId,
    currentPath,
    user: user ? { id: user.id, role: user.role } : user,
    isLoading,
    requireAdmin,
    requireManager,
    requirePlatformAdmin,
    requirePlatformRole,
  });

  // 2026-05-03 first-login race fix: previously this effect used a
  // `hasCheckedAuth = useRef(false)` one-shot guard that locked in the
  // FIRST decision after `isLoading` settled. If the AuthProvider hadn't
  // yet committed `setUser(userData)` from a freshly-completed login when
  // this effect ran, the guard captured `user=null` and redirected to
  // /login — and any subsequent transition to a truthy user could no
  // longer cancel the redirect (the guard short-circuited every later
  // run). The guard has been removed: the effect re-evaluates on every
  // settled state, but only redirects when `!isLoading && !user`. This
  // pairs with the AuthProvider wipe-condition tightening so a stale 401
  // can no longer null out a freshly-seeded user behind this guard's back.
  useEffect(() => {
    routeTrace("ProtectedRoute effect run", {
      mountId,
      currentPath,
      user: user ? { id: user.id, role: user.role } : user,
      isLoading,
    });
    if (isLoading) {
      routeTrace("ProtectedRoute effect early-return (isLoading=true)", { mountId });
      return;
    }

    if (!user) {
      routeTrace("ProtectedRoute REDIRECT → /login (user falsy)", { mountId, from: currentPath });
      setLocation("/login");
      return;
    }

    // Technician hard guard: always redirect to tech app regardless of route
    if (user.role === "technician") {
      routeTrace("ProtectedRoute REDIRECT → /tech/today (technician)", { mountId });
      setLocation("/tech/today");
      return;
    }

    // 2026-04-19 post-login-friction removal: the owner-onboarding
    // redirect was forcing every owner with NULL onboarding_completed_at
    // to /onboarding on every login — a stray friction screen for
    // returning users. The wizard is now reached ONLY via the explicit
    // setLocation("/onboarding") in Signup.tsx's final-submit handler,
    // not via any route guard. Business hours are already seeded
    // silently in onboardingService; timezone defaults to
    // "America/Toronto" in the company_settings schema. Owners who want
    // to set their own timezone do so in Settings, not as a login gate.

    // Platform admin check (most restrictive)
    if (requirePlatformAdmin && user.role !== "platform_admin") {
      routeTrace("ProtectedRoute REDIRECT → /login (platformAdmin gate)", { mountId, role: user.role });
      setLocation("/login");
      return;
    }

    // Phase 6: any platform role
    if (requirePlatformRole && !PLATFORM_ROLES.includes(user.role as string)) {
      routeTrace("ProtectedRoute REDIRECT → /login (platformRole gate)", { mountId, role: user.role });
      setLocation("/login");
      return;
    }

    // Regular admin check
    if (requireAdmin && user.role !== "owner" && user.role !== "admin" && !PLATFORM_ROLES.includes(user.role as string)) {
      routeTrace("ProtectedRoute REDIRECT → /login (admin gate)", { mountId, role: user.role });
      setLocation("/login");
      return;
    }

    // Manager-level check — looser than `requireAdmin`. Allows owner,
    // admin, manager, dispatcher (matches the server's MANAGER_ROLES);
    // platform roles also pass for support sessions.
    if (requireManager && !MANAGER_ROLES.includes(user.role as string) && !PLATFORM_ROLES.includes(user.role as string)) {
      routeTrace("ProtectedRoute REDIRECT → /login (manager gate)", { mountId, role: user.role });
      setLocation("/login");
      return;
    }
    routeTrace("ProtectedRoute auth-check PASSED, render children", { mountId, userId: user.id, role: user.role });
  }, [user, isLoading, requireAdmin, requireManager, requirePlatformAdmin, requirePlatformRole, setLocation]);

  if (isLoading) {
    routeTrace("ProtectedRoute RENDER → Loading…", { mountId });
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (!user) {
    routeTrace("ProtectedRoute RENDER → null (user falsy)", { mountId });
    return null;
  }

  // Platform admin check
  if (requirePlatformAdmin && user.role !== "platform_admin") {
    return null;
  }

  // Phase 6: any platform role
  if (requirePlatformRole && !PLATFORM_ROLES.includes(user.role as string)) {
    return null;
  }

  // Regular admin check (platform roles also pass this check)
  if (requireAdmin && user.role !== "owner" && user.role !== "admin" && !PLATFORM_ROLES.includes(user.role as string)) {
    return null;
  }

  // Manager-level check (platform roles also pass)
  if (requireManager && !MANAGER_ROLES.includes(user.role as string) && !PLATFORM_ROLES.includes(user.role as string)) {
    return null;
  }

  return <>{children}</>;
}
