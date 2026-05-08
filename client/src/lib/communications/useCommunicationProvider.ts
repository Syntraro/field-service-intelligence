/**
 * Provider settings hook — Phase 5 (2026-05-08).
 *
 * Read-only query that powers the SMS composer's tab gating. Returns a
 * minimal status object — `{ hasActive, providerSettings }` — never the
 * provider credentials or webhook secret. The server's
 * `/api/communications/provider-settings` endpoint already enforces this
 * shape; the hook is a thin TanStack Query wrapper.
 *
 * Provider-neutral: the hook returns the canonical `providerId` string
 * but no UI surface should branch on its value beyond "exists / does
 * not exist". Vendor names live exclusively inside the adapter layer.
 */

import { useQuery } from "@tanstack/react-query";

export const COMMUNICATION_PROVIDER_SETTINGS_KEY = [
  "/api/communications/provider-settings",
] as const;

/**
 * Public DTO mirrors `ProviderSettingsPublic` on the server. NEVER
 * carries credentials, webhook secrets, or full account identifiers —
 * the server stripes those server-side before responding.
 */
export interface ProviderSettingsPublic {
  providerId: "twilio" | "telnyx" | "bandwidth";
  phoneNumber: string;
  isActive: boolean;
  /** Last-four digits of the account identifier when present; `null`
   *  otherwise. Used by the Settings UI's "Connected: ••••1234" line. */
  accountIdentifierLast4: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ProviderSettingsResponse {
  settings: ProviderSettingsPublic[];
}

export interface UseCommunicationProviderResult {
  /** True when the tenant has at least one active provider configured. */
  hasActive: boolean;
  /** All configured providers (typically 0 or 1; the server does not
   *  enforce "only one row" — only "only one ACTIVE row" — but the
   *  hub UI shows just the active one). */
  providers: ProviderSettingsPublic[];
  /** Convenience: the active row, or null. */
  active: ProviderSettingsPublic | null;
  isLoading: boolean;
  isError: boolean;
}

export function useCommunicationProvider(): UseCommunicationProviderResult {
  const query = useQuery<ProviderSettingsResponse>({
    queryKey: [...COMMUNICATION_PROVIDER_SETTINGS_KEY],
    // Provider settings change rarely — credentials only get rotated
    // through the (future) settings UI. 5-minute stale window keeps the
    // composer responsive without spamming the API.
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const res = await fetch("/api/communications/provider-settings", {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error(`Failed to load provider settings (${res.status})`);
      }
      return (await res.json()) as ProviderSettingsResponse;
    },
  });
  const settings = query.data?.settings ?? [];
  const active = settings.find((s) => s.isActive) ?? null;
  return {
    hasActive: active !== null,
    providers: settings,
    active,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
