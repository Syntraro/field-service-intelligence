import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
  requirePlatformAdmin?: boolean;
}

export default function ProtectedRoute({ children, requireAdmin = false, requirePlatformAdmin = false }: ProtectedRouteProps) {
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

    // Regular admin check
    if (requireAdmin && user.role !== "owner" && user.role !== "admin" && user.role !== "platform_admin") {
      setLocation("/login");
      return;
    }
  }, [user, isLoading, requireAdmin, requirePlatformAdmin, setLocation]);

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

  // Regular admin check (platform admins also pass this check)
  if (requireAdmin && user.role !== "owner" && user.role !== "admin" && user.role !== "platform_admin") {
    return null;
  }

  return <>{children}</>;
}
