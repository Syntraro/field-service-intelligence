/**
 * Portal Auth Context
 *
 * Separate from staff auth — uses portal session (magic link).
 * Provides: portalUser, isLoading, logout, and paymentsEnabled flag.
 */

import { createContext, useContext, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "./queryClient";

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
}

interface PortalAuthContextType {
  user: PortalUser | null;
  isLoading: boolean;
  logout: () => Promise<void>;
}

const PortalAuthContext = createContext<PortalAuthContextType | undefined>(undefined);

export function PortalAuthProvider({ children }: { children: ReactNode }) {
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
