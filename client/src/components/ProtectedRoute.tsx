import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";

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
  const [, setLocation] = useLocation();

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
    if (isLoading) return;

    if (!user) {
      setLocation("/login");
      return;
    }

    // Technician hard guard: always redirect to tech app regardless of route
    if (user.role === "technician") {
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
      setLocation("/login");
      return;
    }

    // Phase 6: any platform role
    if (requirePlatformRole && !PLATFORM_ROLES.includes(user.role as string)) {
      setLocation("/login");
      return;
    }

    // Regular admin check
    if (requireAdmin && user.role !== "owner" && user.role !== "admin" && !PLATFORM_ROLES.includes(user.role as string)) {
      setLocation("/login");
      return;
    }

    // Manager-level check — looser than `requireAdmin`. Allows owner,
    // admin, manager, dispatcher (matches the server's MANAGER_ROLES);
    // platform roles also pass for support sessions.
    if (requireManager && !MANAGER_ROLES.includes(user.role as string) && !PLATFORM_ROLES.includes(user.role as string)) {
      setLocation("/login");
      return;
    }
  }, [user, isLoading, requireAdmin, requireManager, requirePlatformAdmin, requirePlatformRole, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (!user) {
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
