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
   *  permitted server-side can also reach the corresponding UI.
   *  Technicians are hard-redirected to `/tech/today` before this check
   *  ever runs. */
  requireManager?: boolean;
  /** 2026-05-04 PR8 — allows owner / admin / manager only (mirrors the
   *  server's `RESTRICTED_MANAGER_ROLES`). Tighter than `requireManager`
   *  (excludes dispatcher) and looser than `requireAdmin` (includes
   *  manager). Used by the Payments dashboard surface so the client
   *  gate matches the server's RESTRICTED_MANAGER_ROLES exactly. */
  requireRestrictedManager?: boolean;
  // 2026-05-04 Phase 7: removed `requirePlatformAdmin` and
  // `requirePlatformRole` props. After Phase 6's DB CHECK constraint
  // on `users.role`, the tenant `useAuth()` user can never hold a
  // platform role string — the gates were structurally unreachable.
  // Platform-only pages now live exclusively under `/platform/*` and
  // are wrapped by `<PlatformAuthRoute>` (psid cookie, capability
  // gate). The `/support-console` route, which was the lone consumer
  // of `requirePlatformAdmin`, is also removed (App.tsx).
}

const MANAGER_ROLES = ["owner", "admin", "manager", "dispatcher"];
// 2026-05-04 PR8 — mirrors server `RESTRICTED_MANAGER_ROLES`.
const RESTRICTED_MANAGER_ROLES = ["owner", "admin", "manager"];

// 2026-05-04 Phase 7: removed the local `PLATFORM_ROLES` const and the
// `!PLATFORM_ROLES.includes(user.role)` clauses inside the role gates
// below. Those clauses widened each gate to "tenant role OR platform
// role" so a platform-role tenant user (legacy era) could still
// access tenant routes. Post-Phase-6 the constraint makes that
// impossible — a tenant `user.role` is always a tenant role. The
// gates now check ONLY against the canonical tenant role lists.

export default function ProtectedRoute({
  children,
  requireAdmin = false,
  requireManager = false,
  requireRestrictedManager = false,
}: ProtectedRouteProps) {
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
    requireRestrictedManager,
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

    // Regular admin check
    if (requireAdmin && user.role !== "owner" && user.role !== "admin") {
      routeTrace("ProtectedRoute REDIRECT → /login (admin gate)", { mountId, role: user.role });
      setLocation("/login");
      return;
    }

    // Manager-level check — looser than `requireAdmin`. Allows owner,
    // admin, manager, dispatcher (matches the server's MANAGER_ROLES).
    if (requireManager && !MANAGER_ROLES.includes(user.role as string)) {
      routeTrace("ProtectedRoute REDIRECT → /login (manager gate)", { mountId, role: user.role });
      setLocation("/login");
      return;
    }

    // 2026-05-04 PR8 — Restricted manager gate (owner / admin /
    // manager only — excludes dispatcher). Mirrors the server's
    // RESTRICTED_MANAGER_ROLES used by the Payments dashboard surface.
    if (
      requireRestrictedManager &&
      !RESTRICTED_MANAGER_ROLES.includes(user.role as string)
    ) {
      routeTrace("ProtectedRoute REDIRECT → /login (restricted-manager gate)", { mountId, role: user.role });
      setLocation("/login");
      return;
    }
    routeTrace("ProtectedRoute auth-check PASSED, render children", { mountId, userId: user.id, role: user.role });
  }, [user, isLoading, requireAdmin, requireManager, requireRestrictedManager, setLocation]);

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

  // Regular admin check
  if (requireAdmin && user.role !== "owner" && user.role !== "admin") {
    return null;
  }

  // Manager-level check
  if (requireManager && !MANAGER_ROLES.includes(user.role as string)) {
    return null;
  }

  // Restricted manager-level check — owner/admin/manager only (excludes dispatcher).
  if (
    requireRestrictedManager &&
    !RESTRICTED_MANAGER_ROLES.includes(user.role as string)
  ) {
    return null;
  }

  return <>{children}</>;
}
