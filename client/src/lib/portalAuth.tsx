/**
 * Portal Auth Context
 *
 * Separate from staff auth — uses portal session (magic link).
 * Provides: portalUser, isLoading, logout, and paymentsEnabled flag.
 */

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, initCSRF, queryClient } from "./queryClient";

export interface PortalUser {
  contactId: string;
  customerCompanyId: string;
  companyId: string;
  email: string;
  firstName: string;
  lastName: string;
  companyName: string;
  customerCompanyName: string;
  paymentsEnabled: boolean;
  // 2026-04-19 Portal polish: tenant company contact info for header / footer.
  companyPhone: string | null;
  companyEmail: string | null;
}

interface PortalAuthContextType {
  user: PortalUser | null;
  isLoading: boolean;
  logout: () => Promise<void>;
}

const PortalAuthContext = createContext<PortalAuthContextType | undefined>(undefined);

export function PortalAuthProvider({ children }: { children: ReactNode }) {
  // 2026-05-05: pre-warm the CSRF token so the FIRST mutation (most often
  // a Pay click on PortalInvoiceDetail) doesn't pay a synchronous
  // round-trip to GET /api/csrf-token before the request actually goes
  // out. The tenant app does the same on AuthProvider mount; the portal
  // app previously skipped this because portal pages can be hit cold
  // from an email link with no prior session warm-up. The global csurf
  // middleware applies to /api/portal/* — the token must exist in the
  // session for any portal POST to succeed.
  useEffect(() => {
    initCSRF().catch(() => {});
  }, []);

  const { data, isLoading, isError } = useQuery<PortalUser>({
    queryKey: ["/api/portal/me"],
    retry: false,
  });

  const user = isError ? null : (data ?? null);

  const logoutMutation = useMutation({
    mutationFn: () => apiRequest("/api/portal/auth/logout", { method: "POST" }),
    onSuccess: () => {
      queryClient.setQueryData(["/api/portal/me"], null);
      queryClient.invalidateQueries({ queryKey: ["/api/portal/me"] });
    },
  });

  return (
    <PortalAuthContext.Provider
      value={{
        user,
        isLoading,
        logout: () => logoutMutation.mutateAsync(),
      }}
    >
      {children}
    </PortalAuthContext.Provider>
  );
}

export function usePortalAuth() {
  const ctx = useContext(PortalAuthContext);
  if (!ctx) throw new Error("usePortalAuth must be used within PortalAuthProvider");
  return ctx;
}
