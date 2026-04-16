import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
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

export default function ProtectedRoute({ children, requireAdmin = false, requirePlatformAdmin = false, requirePlatformRole = false }: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();
  const [location, setLocation] = useLocation();
  const hasCheckedAuth = useRef(false);

  useEffect(() => {
    if (isLoading) return;
    
    // Only perform auth checks once on mount, not on hot reload
    if (hasCheckedAuth.current) return;
    hasCheckedAuth.current = true;
    
    if (!user) {
      setLocation("/login");
      return;
    }
    
    // Technician hard guard: always redirect to tech app regardless of route
    if (user.role === "technician") {
      setLocation("/tech/today");
      return;
    }

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
  }, [user, isLoading, requireAdmin, requirePlatformAdmin, requirePlatformRole, setLocation]);

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

  return <>{children}</>;
}
